import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWorkflow } from "../core/workflow-adapter.ts";
import {
	applyWorkflowMigration,
	previewWorkflowMigration,
	recoverWorkflowMigration,
	rollbackWorkflowMigration,
} from "../core/workflow-migration.ts";

const roots: string[] = [];
const rqPath = process.env.BACKLOG_RQ_PATH?.trim();

async function fixture(name: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), `backlog-migration-${name}-中文-`));
	roots.push(root);
	await mkdir(join(root, "backlog", "tickets"), { recursive: true });
	await mkdir(join(root, "backlog", "tasks"), { recursive: true });
	await mkdir(join(root, "backlog", "decisions"), { recursive: true });
	await mkdir(join(root, "backlog", "evidence", "TASK-1"), { recursive: true });
	await mkdir(join(root, ".scratch", "sessions"), { recursive: true });
	await writeFile(join(root, "backlog", "config.yml"), "project_name: Fixture\nprefixes:\n  task: task\n");
	await writeFile(join(root, "backlog", "decisions", "approvals.jsonl"), '{"ticket":"TASK-1","verdict":"accepted"}\n');
	await writeFile(join(root, "backlog", "evidence", "TASK-1", "receipt.md"), "evidence\n");
	await writeFile(join(root, ".scratch", "sessions", "session.json"), '{"ticket":"TASK-1"}\n');
	return root;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("workflow migration", () => {
	it("previews mixed sources and remains read-only", async () => {
		const root = await fixture("preview");
		const raw = "# task-1 Legacy\nStatus: To Do\n\n## Description\nunknown: keep\n";
		await writeFile(join(root, "backlog", "tickets", "task-1 - Legacy.md"), raw);
		await writeFile(
			join(root, "backlog", "tasks", "task-2 - Native.md"),
			"---\nid: TASK-2\ntitle: Native\nstatus: To Do\n---\n",
		);
		const plan = await previewWorkflowMigration(root);
		expect(plan.records.map((record) => record.source)).toEqual(["ticket", "backlog-task"]);
		expect(plan.records[0]?.targetPath).toBe("backlog/tasks/task-1 - Legacy.md");
		expect(plan.records[0]?.associations.approvals).toHaveLength(1);
		expect(plan.records[0]?.conflicts.some((conflict) => conflict.includes("old ticket source identity"))).toBe(false);
		expect(plan.records[0]?.associations.evidence).toEqual(["backlog/evidence/TASK-1/receipt.md"]);
		expect(plan.records[0]?.associations.sessions).toEqual([".scratch/sessions/session.json"]);
		expect(await readFile(join(root, "backlog", "tickets", "task-1 - Legacy.md"), "utf8")).toBe(raw);
	});

	it("preserves rq history association and quotes legacy YAML titles", async () => {
		const root = await fixture("quoted-title");
		const raw = "# task-1 Legacy: Needs review\nStatus: To Do\n";
		await writeFile(join(root, "backlog", "tickets", "task-1 - Legacy.md"), raw);
		const plan = await previewWorkflowMigration(root);
		expect(plan.records[0]?.associations.approvals).toHaveLength(1);
		expect(plan.records[0]?.conflicts).toEqual([]);
		expect(plan.records[0]?.targetContent).toContain('title: "task-1 Legacy: Needs review"');
	});

	it("previews a native-only project when the legacy tickets directory is absent", async () => {
		const root = await fixture("native-only");
		await rm(join(root, "backlog", "tickets"), { recursive: true, force: true });
		await writeFile(
			join(root, "backlog", "tasks", "task-2 - Native.md"),
			"---\nid: TASK-2\ntitle: Native\nstatus: To Do\n---\n",
		);
		const plan = await previewWorkflowMigration(root);
		expect(plan.records.map((record) => record.id)).toEqual(["TASK-2"]);
	});

	it("maps historical workflow statuses to configured native statuses without approval", async () => {
		const root = await fixture("historical-status");
		await mkdir(join(root, "workflow"), { recursive: true });
		await writeFile(join(root, "workflow", "REVIEW-POLICY.md"), "status_map.ready-for-review = in-progress\n");
		await writeFile(join(root, "backlog", "tickets", "task-3 - Accepted.md"), "# task-3 Accepted\nStatus: accepted\n");
		await writeFile(
			join(root, "backlog", "tickets", "task-4 - Review.md"),
			"# task-4 Review\nStatus: ready-for-review\n",
		);
		const plan = await previewWorkflowMigration(root);
		const accepted = plan.records.find((record) => record.id === "TASK-3");
		const review = plan.records.find((record) => record.id === "TASK-4");
		expect(accepted?.conflicts).toEqual([]);
		expect(accepted?.targetContent).toContain("status: Done");
		expect(review?.conflicts).toEqual([]);
		expect(review?.targetContent).toContain("status: In Progress");
	});

	it("keeps accepted history terminal with custom native statuses", async () => {
		const root = await fixture("custom-statuses");
		await writeFile(
			join(root, "backlog", "config.yml"),
			"project_name: Fixture\nprefixes:\n  task: task\nstatuses:\n  - Planned\n  - Doing\n  - Shipped\n",
		);
		await writeFile(join(root, "backlog", "tickets", "task-3 - Accepted.md"), "# task-3 Accepted\nStatus: accepted\n");
		await writeFile(
			join(root, "backlog", "tickets", "task-4 - Review.md"),
			"# task-4 Review\nStatus: ready-for-review\n",
		);
		const plan = await previewWorkflowMigration(root);
		expect(plan.records.find((record) => record.id === "TASK-3")?.targetContent).toContain("status: Shipped");
		expect(plan.records.find((record) => record.id === "TASK-4")?.targetContent).toContain("status: Doing");
	});

	it("reports unsupported prefixes and duplicate identities", async () => {
		const root = await fixture("conflicts");
		await writeFile(join(root, "backlog", "tickets", "T-1 - Legacy.md"), "# T-1 Legacy\n");
		await writeFile(join(root, "backlog", "tickets", "task-2 - Legacy.md"), "---\nid: TASK-2\n---\n");
		await writeFile(join(root, "backlog", "tasks", "task-2 - Native.md"), "---\nid: TASK-2\n---\n");
		const plan = await previewWorkflowMigration(root);
		expect(plan.conflicts.some((conflict) => conflict.includes("unsupported task prefix"))).toBe(true);
		expect(plan.conflicts.some((conflict) => conflict.includes("identity collision"))).toBe(true);
	});

	it("applies, recovers an interrupted journal, and rolls back without changing ledger", async () => {
		const root = await fixture("apply");
		const raw = "# task-1 Legacy\nStatus: To Do\n\n## Description\nunknown: keep\n";
		await writeFile(join(root, "backlog", "tickets", "task-1 - Legacy.md"), raw);
		const ledger = '{"ticket":"TASK-10","verdict":"accepted"}\n';
		await writeFile(join(root, "backlog", "decisions", "approvals.jsonl"), ledger);
		const plan = await previewWorkflowMigration(root);
		const result = await applyWorkflowMigration(plan, {
			confirm: true,
			fingerprint: plan.fingerprint,
			workspace: "fixture",
		});
		expect(result.moved).toBe(1);
		expect(await readFile(join(root, "backlog", "tasks", "task-1 - Legacy.md"), "utf8")).toContain("id: TASK-1");
		expect(await readFile(join(root, "backlog", "tasks", "task-1 - Legacy.md"), "utf8")).toContain("unknown: keep");
		expect(await readFile(join(root, result.backup, "backlog__tickets__task-1 - Legacy.md"), "utf8")).toBe(raw);
		const interrupted = JSON.parse(await readFile(join(root, result.journal), "utf8")) as {
			records: Array<{ state: string }>;
		};
		const first = interrupted.records[0];
		if (!first) throw new Error("migration journal unexpectedly has no records");
		first.state = "pending";
		await writeFile(join(root, result.journal), JSON.stringify(interrupted));
		await recoverWorkflowMigration(root, plan.fingerprint);
		expect(
			(await applyWorkflowMigration(plan, { confirm: true, fingerprint: plan.fingerprint, workspace: "fixture" }))
				.moved,
		).toBe(1);
		expect(await readFile(join(root, "backlog", "decisions", "approvals.jsonl"), "utf8")).toBe(ledger);
		await rollbackWorkflowMigration(root, plan.fingerprint);
		expect(await readFile(join(root, "backlog", "tickets", "task-1 - Legacy.md"), "utf8")).toBe(raw);
	});

	it("refuses rollback over a concurrent source", async () => {
		const root = await fixture("concurrent");
		await writeFile(join(root, "backlog", "tickets", "task-1 - Legacy.md"), "# task-1 Legacy\nStatus: To Do\n");
		await writeFile(join(root, "backlog", "decisions", "approvals.jsonl"), '{"ticket":"TASK-10"}\n');
		const plan = await previewWorkflowMigration(root);
		await applyWorkflowMigration(plan, { confirm: true, fingerprint: plan.fingerprint, workspace: "fixture" });
		await writeFile(join(root, "backlog", "tickets", "task-1 - Legacy.md"), "changed\n");
		await expect(rollbackWorkflowMigration(root, plan.fingerprint)).rejects.toThrow("overwrite concurrent");
	});

	it("keeps source and concurrent target when no-replace loses the race", async () => {
		const root = await fixture("target-race");
		const source = join(root, "backlog", "tickets", "task-1 - Legacy.md");
		const target = join(root, "backlog", "tasks", "task-1 - Legacy.md");
		await writeFile(source, "# task-1 Legacy\nStatus: To Do\n");
		await writeFile(join(root, "backlog", "decisions", "approvals.jsonl"), '{"ticket":"TASK-10"}\n');
		const plan = await previewWorkflowMigration(root);
		await writeFile(target, "concurrent target\n");
		await expect(
			applyWorkflowMigration(plan, { confirm: true, fingerprint: plan.fingerprint, workspace: "fixture" }),
		).rejects.toThrow("target already exists");
		expect(await readFile(source, "utf8")).toContain("task-1 Legacy");
		expect(await readFile(target, "utf8")).toBe("concurrent target\n");
	});

	it("recovers a publish-before-unlink crash with both copies intact", async () => {
		const root = await fixture("dual-side-recovery");
		const raw = "# task-1 Legacy\nStatus: To Do\n";
		await writeFile(join(root, "backlog", "tickets", "task-1 - Legacy.md"), raw);
		const plan = await previewWorkflowMigration(root);
		const result = await applyWorkflowMigration(plan, {
			confirm: true,
			fingerprint: plan.fingerprint,
			workspace: "fixture",
		});
		const journal = JSON.parse(await readFile(join(root, result.journal), "utf8")) as {
			records: Array<{
				state: string;
				sourcePath: string;
				targetPath: string;
				contentHash: string;
				targetHash: string;
			}>;
		};
		const record = journal.records.find((entry) => entry.state === "moved");
		if (!record) throw new Error("missing moved record");
		record.state = "pending";
		await writeFile(join(root, result.journal), JSON.stringify(journal));
		await writeFile(join(root, record.sourcePath), raw);
		await recoverWorkflowMigration(root, plan.fingerprint);
		expect(await Bun.file(join(root, record.sourcePath)).exists()).toBe(false);
		expect(await Bun.file(join(root, record.targetPath)).exists()).toBe(true);
	});

	it("recovers two pending records and rolls both back idempotently", async () => {
		const root = await fixture("two-records");
		const raw1 = "# task-1 One\nStatus: To Do\n";
		const raw2 = "# task-2 Two\nStatus: To Do\n";
		await writeFile(join(root, "backlog", "tickets", "task-1 - One.md"), raw1);
		await writeFile(join(root, "backlog", "tickets", "task-2 - Two.md"), raw2);
		await writeFile(join(root, "backlog", "decisions", "approvals.jsonl"), '{"ticket":"TASK-10"}\n');
		const plan = await previewWorkflowMigration(root);
		const result = await applyWorkflowMigration(plan, {
			confirm: true,
			fingerprint: plan.fingerprint,
			workspace: "fixture",
		});
		const journal = JSON.parse(await readFile(join(root, result.journal), "utf8")) as {
			records: Array<{ state: string }>;
		};
		for (const record of journal.records) if (record.state === "moved") record.state = "pending";
		await writeFile(join(root, result.journal), JSON.stringify(journal));
		await recoverWorkflowMigration(root, plan.fingerprint);
		await rollbackWorkflowMigration(root, plan.fingerprint);
		await rollbackWorkflowMigration(root, plan.fingerprint);
		expect(await readFile(join(root, "backlog", "tickets", "task-1 - One.md"), "utf8")).toBe(raw1);
		expect(await readFile(join(root, "backlog", "tickets", "task-2 - Two.md"), "utf8")).toBe(raw2);
	});

	it("rejects a source directory symlink that escapes the workspace", async () => {
		const root = await fixture("symlink");
		const outside = await mkdtemp(join(tmpdir(), "backlog-migration-outside-"));
		roots.push(outside);
		await rm(join(root, "backlog", "tickets"), { recursive: true, force: true });
		try {
			await symlink(outside, join(root, "backlog", "tickets"), "junction");
		} catch {
			return;
		}
		await expect(previewWorkflowMigration(root)).rejects.toThrow("symlink escapes");
	});

	it.skipIf(!rqPath)("runs an isolated rq request through migration without rewriting its ledger", async () => {
		if (!rqPath) return;
		const root = await fixture("rq-integration");
		const { Core } = await import("../core/backlog.ts");
		const configCore = new Core(root);
		const config = await configCore.filesystem.loadConfig();
		if (!config) throw new Error("fixture config missing");
		await configCore.filesystem.saveConfig({ ...config, prefixes: { ...config.prefixes, task: "T" } });
		configCore.disposeContentStore();
		configCore.disposeSearchService();
		await mkdir(join(root, "backlog", "specs"), { recursive: true });
		await writeFile(join(root, "backlog", "specs", "question.md"), "# Question\n");
		const source = join(root, "backlog", "tickets", "T-001-test.md");
		await writeFile(source, "# T-001 test\nStatus: To Do\n");
		await mkdir(join(root, "backlog", "evidence", "T-001"), { recursive: true });
		await writeFile(join(root, "backlog", "evidence", "T-001", "receipt.md"), "T-001 evidence\n");
		await writeFile(join(root, ".scratch", "sessions", "session-t001.json"), '{"ticket":"T-001"}\n');
		const options = { root, rq: rqPath, enabled: true };
		const request = await runWorkflow(
			["request", "T-001", "review", "Approve the migrated record", "--subject-key", "backlog/specs/question.md"],
			options,
		);
		expect(request.exitCode).toBe(0);
		const ledgerPath = join(root, "backlog", "decisions", "approvals.jsonl");
		const ledgerBefore = await readFile(ledgerPath, "utf8");
		const evidencePath = join(root, "backlog", "evidence", "T-001", "receipt.md");
		const sessionPath = join(root, ".scratch", "sessions", "session-t001.json");
		const evidenceBefore = await readFile(evidencePath, "utf8");
		const sessionBefore = await readFile(sessionPath, "utf8");
		const plan = await previewWorkflowMigration(root);
		const migrationRecord = plan.records.find((record) => record.id === "T-001");
		expect(migrationRecord?.associations.evidence).toEqual(["backlog/evidence/T-001/receipt.md"]);
		expect(migrationRecord?.associations.sessions).toEqual([".scratch/sessions/session-t001.json"]);
		const ledgerBeforeLines = ledgerBefore.trim().split(/\r?\n/);
		expect(
			ledgerBeforeLines.some((line) => {
				try {
					return (JSON.parse(line) as { source_key?: string }).source_key === "ticket:backlog/tickets/T-001-test.md";
				} catch {
					return false;
				}
			}),
		).toBe(true);
		const nativeTaskCountBefore = (await readdir(join(root, "backlog", "tasks"))).filter((name) =>
			name.endsWith(".md"),
		).length;
		const result = await applyWorkflowMigration(plan, {
			confirm: true,
			fingerprint: plan.fingerprint,
			workspace: "fixture",
		});
		expect(result.moved).toBe(1);
		expect(await readFile(ledgerPath, "utf8")).toBe(ledgerBefore);
		expect(await readFile(evidencePath, "utf8")).toBe(evidenceBefore);
		expect(await readFile(sessionPath, "utf8")).toBe(sessionBefore);
		expect((await readdir(join(root, "backlog", "tasks"))).filter((name) => name.endsWith(".md")).length).toBe(
			nativeTaskCountBefore + 1,
		);
		const board = await runWorkflow(["board", "--plain"], options);
		expect(board.exitCode).toBe(0);
		expect(board.stdout).toContain('"original_id": "T-001"');
		const card = await runWorkflow(["card", "T-001"], options);
		expect(card.exitCode).toBe(0);
		await rollbackWorkflowMigration(root, plan.fingerprint);
		expect(await Bun.file(source).exists()).toBe(true);
		expect(await Bun.file(join(root, "backlog", "tasks", "T-001-test.md")).exists()).toBe(false);
		expect(await readFile(ledgerPath, "utf8")).toBe(ledgerBefore);
		expect((await readdir(join(root, "backlog", "tasks"))).filter((name) => name.endsWith(".md")).length).toBe(
			nativeTaskCountBefore,
		);
	});
});
