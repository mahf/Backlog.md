import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import lockfile from "proper-lockfile";
import { parseTask } from "../markdown/parser.ts";
import { getTerminalStatus } from "../utils/terminal-status.ts";
import { moveWithoutReplacing } from "./archived-task-move.ts";
import { Core } from "./backlog.ts";

export type MigrationSource = "ticket" | "backlog-task";

export interface MigrationAssociation {
	approvals: string[];
	evidence: string[];
	sessions: string[];
}

export interface MigrationRecord {
	source: MigrationSource;
	id: string;
	sourcePath: string;
	targetPath: string;
	identity: { sourceType: MigrationSource; originalId: string };
	status?: string;
	associations: MigrationAssociation;
	conflicts: string[];
	contentHash: string;
	targetHash: string;
	targetContent: string;
}

export interface WorkflowMigrationPlan {
	root: string;
	target: string;
	records: MigrationRecord[];
	conflicts: string[];
	fingerprint: string;
}

export interface WorkflowMigrationResult {
	fingerprint: string;
	moved: number;
	backup: string;
	journal: string;
}

interface JournalRecord {
	sourcePath: string;
	targetPath: string;
	backupPath: string;
	contentHash: string;
	targetHash: string;
	targetContent: string;
	state: "pending" | "moved" | "unchanged" | "rolled-back";
}

interface Journal {
	version: 1;
	fingerprint: string;
	root: string;
	records: JournalRecord[];
}

function hash(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function pathUnder(root: string, candidate: string): string {
	const absoluteRoot = resolve(root);
	const absolute = resolve(candidate);
	const rest = relative(absoluteRoot, absolute);
	if (!rest || rest === ".." || rest.startsWith(`..${sep}`) || isAbsolute(rest)) {
		throw new Error(`Migration path escapes workspace root: ${candidate}`);
	}
	return absolute;
}

async function canonicalDirectory(root: string, candidate: string): Promise<string> {
	const lexical = pathUnder(root, candidate);
	const canonicalRoot = await realpath(root);
	const canonical = await realpath(lexical);
	const rest = relative(canonicalRoot, canonical);
	if (!rest || rest === ".." || rest.startsWith(`..${sep}`) || isAbsolute(rest))
		throw new Error(`Migration symlink escapes workspace root: ${candidate}`);
	return canonical;
}

async function canonicalDirectoryOrMissing(root: string, candidate: string): Promise<string> {
	try {
		return await canonicalDirectory(root, candidate);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return pathUnder(root, candidate);
	}
}

async function assertParentUnder(root: string, candidate: string): Promise<void> {
	const canonicalRoot = await realpath(root);
	const parent = await realpath(dirname(candidate));
	const rest = relative(canonicalRoot, parent);
	if (!rest || rest === ".." || rest.startsWith(`..${sep}`) || isAbsolute(rest))
		throw new Error(`Migration write path escapes workspace root: ${candidate}`);
}

async function withMigrationLock<T>(root: string, action: () => Promise<T>): Promise<T> {
	const canonicalRoot = await realpath(resolve(root));
	const release = await lockfile.lock(canonicalRoot, {
		lockfilePath: join(canonicalRoot, ".backlog-workflow-migration.lock"),
		retries: 0,
	});
	try {
		return await action();
	} finally {
		await release();
	}
}

function relativePath(root: string, filePath: string): string {
	return relative(root, filePath).split(sep).join("/");
}

async function files(directory: string): Promise<string[]> {
	try {
		return (await readdir(directory, { withFileTypes: true }))
			.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md") && !entry.name.startsWith("_"))
			.map((entry) => join(directory, entry.name))
			.sort((left, right) => basename(left).localeCompare(basename(right)));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

function declaredId(content: string, filename: string): string {
	const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/m)?.[1] ?? "";
	const id = frontmatter.match(/^id\s*:\s*["']?([^"'\r\n]+)["']?\s*$/im)?.[1]?.trim();
	const fromName = filename.match(/^([^-]+-[^-\s]+)(?:\s+-|[-\s])/i)?.[1];
	return (id || fromName || filename.replace(/\.md$/i, "")).toUpperCase();
}

function statusOf(content: string): string | undefined {
	return (
		content.match(/^status\s*:\s*["'`]?([^"'`\r\n]+)["'`]?\s*$/im)?.[1] ??
		content.match(/^[-*\s]*\*{0,2}Status\*{0,2}\s*:\s*\*{0,2}\s*`?([^`\r\n]+)`?/im)?.[1]
	)?.trim();
}

const DEFAULT_WORKFLOW_STATUS_MAP: Record<string, string> = {
	"needs-triage": "To Do",
	"needs-info": "To Do",
	"ready-for-agent": "To Do",
	"in-progress": "In Progress",
	"in-review": "In Progress",
	"ready-for-human": "In Progress",
	"ready-for-review": "In Progress",
	"human-approved": "Done",
	accepted: "Done",
	blocked: "In Progress",
	wontfix: "Done",
	superseded: "Done",
	obsolete: "Done",
};

function parseWorkflowStatusMap(policy: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const match of policy.matchAll(/^\s*status_map\.([^=\r\n]+?)\s*=\s*(\S+)\s*$/gim)) {
		const source = match[1]?.trim().toLowerCase();
		const target = match[2]?.trim();
		if (source && target) result[source] = target;
	}
	return result;
}

function mappedNativeStatus(status: string, statuses: string[], policyMap: Record<string, string>): string | undefined {
	const exact = statuses.find((candidate) => candidate.toLowerCase() === status.toLowerCase());
	if (exact) return exact;
	const explicitMapping = policyMap[status.toLowerCase()];
	const mapped = explicitMapping ?? DEFAULT_WORKFLOW_STATUS_MAP[status.toLowerCase()];
	if (!mapped) return undefined;
	const mappedExact = statuses.find(
		(candidate) =>
			candidate.toLowerCase() === mapped.toLowerCase() ||
			candidate.toLowerCase().replaceAll("-", " ") === mapped.toLowerCase().replaceAll("-", " "),
	);
	if (mappedExact) return mappedExact;
	const terminal = getTerminalStatus(statuses);
	if (
		!explicitMapping &&
		["done", "accepted", "human-approved", "wontfix", "superseded", "obsolete"].includes(mapped.toLowerCase())
	)
		return terminal ?? undefined;
	if (explicitMapping) return undefined;
	return statuses.find((candidate) => /in[ -]?progress|active|doing/i.test(candidate)) ?? statuses[0];
}

function normalizeLegacyTicket(
	content: string,
	id: string,
	statuses: string[],
	policyMap: Record<string, string>,
): string {
	try {
		const parsed = parseTask(content);
		if (
			parsed.id.toUpperCase() === id &&
			parsed.title.trim() &&
			parsed.status.trim() &&
			statuses.some((status) => status.toLowerCase() === parsed.status.toLowerCase())
		)
			return content;
	} catch {}
	const title =
		content
			.match(/^#\s+(?:Ticket:\s*)?(.+)$/im)?.[1]
			?.replace(id, "")
			.trim() || id;
	const status = statusOf(content);
	if (!status) throw new Error("record has no explicit status; refusing to invent To Do");
	const nativeStatus = mappedNativeStatus(status, statuses, policyMap);
	if (!nativeStatus) throw new Error(`record status ${status} is not configured for this project`);
	// JSON strings are valid YAML scalars and preserve punctuation/newlines safely.
	return `---\nid: ${id}\ntitle: ${JSON.stringify(title)}\nstatus: ${nativeStatus}\nassignee: []\nlabels: []\ndependencies: []\n---\n${content.replace(/^\uFEFF/, "")}`;
}

async function association(root: string, id: string, sourcePath: string): Promise<MigrationAssociation> {
	const result: MigrationAssociation = { approvals: [], evidence: [], sessions: [] };
	const ledger = join(root, "backlog", "decisions", "approvals.jsonl");
	try {
		const lines = (await readFile(ledger, "utf8")).split(/\r?\n/);
		lines.forEach((line, index) => {
			if (!line) return;
			try {
				const event = JSON.parse(line) as Record<string, unknown>;
				const sourceKey = typeof event.source_key === "string" ? event.source_key : "";
				const exact = ["ticket", "original_id"].some(
					(key) => typeof event[key] === "string" && event[key].toUpperCase() === id,
				);
				const oldPath = `ticket:${sourcePath}`;
				if (exact || sourceKey.toLowerCase() === oldPath.toLowerCase())
					result.approvals.push(`${relativePath(root, ledger)}:${index + 1}`);
			} catch (error) {
				throw new Error(`Cannot parse workflow ledger line ${index + 1}.`, { cause: error });
			}
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const evidenceRoot = join(root, "backlog", "evidence");
	try {
		for (const entry of await readdir(evidenceRoot, { withFileTypes: true })) {
			if (entry.name.toLowerCase() !== id.toLowerCase()) continue;
			const directory = join(evidenceRoot, entry.name);
			for (const item of await readdir(directory)) result.evidence.push(relativePath(root, join(directory, item)));
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const sessionsRoot = join(root, ".scratch", "sessions");
	try {
		for (const item of await readdir(sessionsRoot)) {
			const file = join(sessionsRoot, item);
			try {
				const session = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
				const exact = ["ticket", "original_id"].some(
					(key) => typeof session[key] === "string" && session[key].toUpperCase() === id,
				);
				if (exact) result.sessions.push(relativePath(root, file));
			} catch (error) {
				throw new Error(`Cannot parse workflow session ${relativePath(root, file)}.`, { cause: error });
			}
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	return result;
}

function fingerprint(plan: Omit<WorkflowMigrationPlan, "fingerprint">): string {
	return hash(
		JSON.stringify({
			target: plan.target,
			records: plan.records.map((record) => ({
				source: record.source,
				id: record.id,
				sourcePath: record.sourcePath,
				targetPath: record.targetPath,
				contentHash: record.contentHash,
				targetHash: record.targetHash,
				conflicts: record.conflicts,
			})),
			conflicts: plan.conflicts,
		}),
	);
}

/** Build a deterministic, read-only migration plan. */
export async function previewWorkflowMigration(root: string): Promise<WorkflowMigrationPlan> {
	const projectRoot = await realpath(resolve(root));
	const core = new Core(projectRoot);
	const config = await core.filesystem.loadConfig();
	if (!config) throw new Error(`No Backlog.md project found at ${projectRoot}.`);
	const ticketsDir = await canonicalDirectoryOrMissing(projectRoot, join(core.filesystem.backlogDir, "tickets"));
	const tasksDir = await canonicalDirectoryOrMissing(projectRoot, join(core.filesystem.backlogDir, "tasks"));
	let policyMap: Record<string, string> = {};
	try {
		policyMap = parseWorkflowStatusMap(await readFile(join(projectRoot, "workflow", "REVIEW-POLICY.md"), "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const target = relativePath(projectRoot, tasksDir);
	const ticketFiles = await files(ticketsDir);
	const taskFiles = await files(tasksDir);
	const existing = new Map<string, string>();
	const records: MigrationRecord[] = [];
	const conflicts: string[] = [];
	const ticketIds = new Map<string, string[]>();
	for (const file of taskFiles) {
		const content = await readFile(file, "utf8");
		const id = declaredId(content, basename(file));
		existing.set(id, relativePath(projectRoot, file));
	}
	for (const file of ticketFiles) {
		const content = await readFile(file, "utf8");
		const id = declaredId(content, basename(file));
		const sourcePath = relativePath(projectRoot, file);
		const targetPath = relativePath(projectRoot, join(tasksDir, basename(file)));
		const localConflicts: string[] = [];
		let targetContent = content;
		try {
			targetContent = normalizeLegacyTicket(content, id, config.statuses, policyMap);
			parseTask(targetContent);
		} catch (error) {
			localConflicts.push(
				error instanceof Error ? error.message : "record cannot be normalized to a native Backlog task",
			);
		}
		const sameId = ticketIds.get(id) ?? [];
		sameId.push(sourcePath);
		ticketIds.set(id, sameId);
		const configuredPrefix = config.prefixes?.task ?? "task";
		if (!new RegExp(`^${configuredPrefix}-`, "i").test(id))
			localConflicts.push(`unsupported task prefix for ${id}; configured prefix is ${configuredPrefix}`);
		if (existing.has(id)) localConflicts.push(`identity collision with ${existing.get(id)}`);
		const associations = await association(projectRoot, id, sourcePath);
		if (localConflicts.length) conflicts.push(`${sourcePath}: ${localConflicts.join("; ")}`);
		records.push({
			source: "ticket",
			id,
			sourcePath,
			targetPath,
			identity: { sourceType: "ticket", originalId: id },
			status: statusOf(content),
			associations,
			conflicts: localConflicts,
			contentHash: hash(content),
			targetHash: hash(targetContent),
			targetContent,
		});
	}
	for (const [id, paths] of ticketIds) {
		if (paths.length < 2) continue;
		const conflict = `ambiguous duplicate identity ${id}: ${paths.join(", ")}`;
		conflicts.push(conflict);
		for (const record of records.filter((item) => item.source === "ticket" && item.id === id))
			record.conflicts.push(conflict);
	}
	for (const file of taskFiles) {
		const content = await readFile(file, "utf8");
		const id = declaredId(content, basename(file));
		records.push({
			source: "backlog-task",
			id,
			sourcePath: relativePath(projectRoot, file),
			targetPath: relativePath(projectRoot, file),
			identity: { sourceType: "backlog-task", originalId: id },
			status: statusOf(content),
			associations: await association(projectRoot, id, relativePath(projectRoot, file)),
			conflicts: [],
			contentHash: hash(content),
			targetHash: hash(content),
			targetContent: content,
		});
	}
	records.sort((left, right) =>
		`${left.id}:${left.source}:${left.sourcePath}`.localeCompare(`${right.id}:${right.source}:${right.sourcePath}`),
	);
	const base = { root: projectRoot, target, records, conflicts: [...new Set(conflicts)].sort() };
	return { ...base, fingerprint: fingerprint(base) };
}

async function writeJournal(path: string, journal: Journal): Promise<void> {
	const temporary = `${path}.tmp-${process.pid}`;
	await writeFile(temporary, JSON.stringify(journal, null, 2), "utf8");
	await rename(temporary, path);
}

async function ensureUnchanged(path: string, expected: string): Promise<void> {
	const content = await readFile(path, "utf8");
	if (hash(content) !== expected) throw new Error(`Migration source changed after preview: ${path}`);
}

async function ensureBackup(path: string, source: string, expected: string): Promise<void> {
	if (
		await lstat(path).then(
			() => true,
			() => false,
		)
	) {
		await ensureUnchanged(path, expected);
		return;
	}
	await mkdir(resolve(path, ".."), { recursive: true });
	await copyFile(source, path, 0);
	await ensureUnchanged(path, expected);
}

async function moveRecord(source: string, target: string, targetContent: string): Promise<void> {
	if (targetContent === (await readFile(source, "utf8"))) {
		await moveWithoutReplacing(source, target);
		return;
	}
	const temporary = `${target}.migration-${process.pid}`;
	await writeFile(temporary, targetContent, { flag: "wx" });
	try {
		await moveWithoutReplacing(temporary, target);
		await unlink(source);
	} catch (error) {
		// Never remove target: after a no-replace race it may belong to another writer.
		await unlink(temporary).catch(() => undefined);
		throw error;
	}
}

async function readJournal(projectRoot: string, fingerprintValue: string): Promise<{ path: string; journal: Journal }> {
	const journalPath = pathUnder(
		projectRoot,
		join(projectRoot, ".backlog-workflow-migration", fingerprintValue, "journal.json"),
	);
	const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
	if (
		journal.version !== 1 ||
		journal.fingerprint !== fingerprintValue ||
		resolve(journal.root) !== resolve(projectRoot)
	)
		throw new Error("Migration journal does not match the workspace root or reviewed plan.");
	return { path: journalPath, journal };
}

/** Apply a reviewed plan using raw-file no-replace moves and an external backup/journal. */
async function applyWorkflowMigrationUnlocked(
	plan: WorkflowMigrationPlan,
	options: { confirm: boolean; fingerprint: string; workspace?: string },
): Promise<WorkflowMigrationResult> {
	if (!options.workspace) throw new Error("Migration apply requires one explicit --workspace.");
	if (!options.confirm) throw new Error("Migration apply requires --confirm.");
	if (options.fingerprint !== plan.fingerprint)
		throw new Error("Migration plan fingerprint is stale or was not reviewed.");
	if (plan.conflicts.length || plan.records.some((record) => record.conflicts.length))
		throw new Error("Migration preview contains conflicts; resolve them before apply.");
	const root = resolve(plan.root);
	const migrationRoot = pathUnder(root, join(root, ".backlog-workflow-migration", plan.fingerprint));
	const backupRoot = pathUnder(migrationRoot, join(migrationRoot, "backup"));
	const journalPath = pathUnder(migrationRoot, join(migrationRoot, "journal.json"));
	await mkdir(join(root, ".backlog-workflow-migration"), { recursive: true });
	try {
		await mkdir(migrationRoot);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		const existing = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
		if (existing.fingerprint !== plan.fingerprint || existing.root !== root)
			throw new Error("Migration journal does not match the reviewed plan.");
		if (existing.records.every((entry) => entry.state === "moved" || entry.state === "unchanged"))
			return {
				fingerprint: plan.fingerprint,
				moved: existing.records.filter((entry) => entry.state === "moved").length,
				backup: relativePath(root, backupRoot),
				journal: relativePath(root, journalPath),
			};
		throw new Error("Migration journal is incomplete; use migration recover before retrying.");
	}
	await mkdir(backupRoot);
	const journal: Journal = {
		version: 1,
		fingerprint: plan.fingerprint,
		root,
		records: plan.records.map((record) => ({
			sourcePath: record.sourcePath,
			targetPath: record.targetPath,
			backupPath: relativePath(root, pathUnder(backupRoot, join(backupRoot, record.sourcePath.replaceAll("/", "__")))),
			contentHash: record.contentHash,
			targetHash: record.targetHash,
			targetContent: record.targetContent,
			state: record.source === "ticket" ? "pending" : "unchanged",
		})),
	};
	await writeJournal(journalPath, journal);
	for (const record of plan.records.filter((item) => item.source === "ticket")) {
		const source = pathUnder(root, join(root, record.sourcePath));
		const target = pathUnder(root, join(root, record.targetPath));
		const backup = pathUnder(backupRoot, join(backupRoot, record.sourcePath.replaceAll("/", "__")));
		await assertParentUnder(root, source);
		await assertParentUnder(root, target);
		await assertParentUnder(root, backup);
		const entry = journal.records.find((item) => item.sourcePath === record.sourcePath);
		if (!entry) throw new Error(`Migration journal is missing ${record.sourcePath}.`);
		await ensureUnchanged(source, record.contentHash);
		if (
			await lstat(target).then(
				() => true,
				() => false,
			)
		)
			throw new Error(`Migration target already exists: ${target}`);
		await copyFile(source, backup, 0);
		await moveRecord(source, target, record.targetContent);
		entry.state = "moved";
		await writeJournal(journalPath, journal);
	}
	return {
		fingerprint: plan.fingerprint,
		moved: journal.records.filter((entry) => entry.state === "moved").length,
		backup: relativePath(root, backupRoot),
		journal: relativePath(root, journalPath),
	};
}

export async function applyWorkflowMigration(
	plan: WorkflowMigrationPlan,
	options: { confirm: boolean; fingerprint: string; workspace?: string },
): Promise<WorkflowMigrationResult> {
	return await withMigrationLock(plan.root, () => applyWorkflowMigrationUnlocked(plan, options));
}

/** Restore a completed migration only when neither side was changed concurrently. */
async function rollbackWorkflowMigrationUnlocked(root: string, fingerprintValue: string): Promise<void> {
	const projectRoot = resolve(root);
	const journalPath = pathUnder(
		projectRoot,
		join(projectRoot, ".backlog-workflow-migration", fingerprintValue, "journal.json"),
	);
	const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
	if (journal.version !== 1 || journal.fingerprint !== fingerprintValue || resolve(journal.root) !== projectRoot)
		throw new Error("Migration journal does not match the workspace root or reviewed plan.");
	for (const entry of [...journal.records].reverse()) {
		if (entry.state !== "moved") continue;
		const source = pathUnder(projectRoot, join(projectRoot, entry.sourcePath));
		const target = pathUnder(projectRoot, join(projectRoot, entry.targetPath));
		const backup = pathUnder(projectRoot, join(projectRoot, entry.backupPath));
		await assertParentUnder(projectRoot, source);
		await assertParentUnder(projectRoot, target);
		await assertParentUnder(projectRoot, backup);
		const sourceExists = await lstat(source).then(
			() => true,
			() => false,
		);
		const targetExists = await lstat(target).then(
			() => true,
			() => false,
		);
		if (sourceExists && !targetExists) {
			await ensureUnchanged(source, entry.contentHash);
			entry.state = "rolled-back";
			await writeJournal(journalPath, journal);
			continue;
		}
		if (sourceExists) throw new Error(`Rollback refuses to overwrite concurrent file: ${source}`);
		await ensureUnchanged(target, entry.targetHash);
		await ensureUnchanged(backup, entry.contentHash);
		await copyFile(backup, source, 0);
		try {
			await unlink(target);
		} catch (error) {
			await unlink(source).catch(() => undefined);
			throw error;
		}
		entry.state = "rolled-back";
		await writeJournal(journalPath, journal);
	}
	await writeJournal(journalPath, journal);
}

export async function rollbackWorkflowMigration(root: string, fingerprintValue: string): Promise<void> {
	return await withMigrationLock(root, () => rollbackWorkflowMigrationUnlocked(root, fingerprintValue));
}

async function recoverWorkflowMigrationUnlocked(root: string, fingerprintValue: string): Promise<void> {
	const projectRoot = resolve(root);
	const checked = await readJournal(projectRoot, fingerprintValue);
	const journal = checked.journal;
	const validatedJournalPath = checked.path;
	for (const entry of journal.records) {
		if (entry.state !== "pending") continue;
		const source = pathUnder(projectRoot, join(projectRoot, entry.sourcePath));
		const target = pathUnder(projectRoot, join(projectRoot, entry.targetPath));
		const backup = pathUnder(projectRoot, join(projectRoot, entry.backupPath));
		await assertParentUnder(projectRoot, source);
		await assertParentUnder(projectRoot, target);
		await assertParentUnder(projectRoot, backup);
		const targetExists = await lstat(target).then(
			() => true,
			() => false,
		);
		const sourceExists = await lstat(source).then(
			() => true,
			() => false,
		);
		if (targetExists && !sourceExists) {
			await ensureUnchanged(target, entry.targetHash);
			await ensureUnchanged(backup, entry.contentHash);
			entry.state = "moved";
		} else if (targetExists && sourceExists) {
			// A crash after publishing the target but before unlinking the source is recoverable
			// only when both copies still match this journal.
			await ensureUnchanged(source, entry.contentHash);
			await ensureUnchanged(target, entry.targetHash);
			await ensureUnchanged(backup, entry.contentHash);
			await unlink(source);
			entry.state = "moved";
		} else if (sourceExists) {
			await ensureUnchanged(source, entry.contentHash);
			await ensureBackup(backup, source, entry.contentHash);
			if (targetExists) throw new Error(`Recovery refuses to overwrite concurrent file: ${target}`);
			await moveRecord(source, target, entry.targetContent);
			entry.state = "moved";
		} else {
			throw new Error(`Recovery cannot find migration record at ${source} or ${target}.`);
		}
		await writeJournal(validatedJournalPath, journal);
	}
	await writeJournal(validatedJournalPath, journal);
}

export async function recoverWorkflowMigration(root: string, fingerprintValue: string): Promise<void> {
	return await withMigrationLock(root, () => recoverWorkflowMigrationUnlocked(root, fingerprintValue));
}
