import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, parse, resolve, sep } from "node:path";
import lockfile from "proper-lockfile";
import { resolveBacklogDirectory } from "../utils/backlog-directory.ts";

export interface WorkspaceEntry {
	id: string;
	name: string;
	rootPath: string;
	writable: boolean;
}

export interface WorkspaceListEntry extends WorkspaceEntry {
	error?: string;
}

interface WorkspaceFile {
	version: 1;
	workspaces: WorkspaceEntry[];
}

const REGISTRY_VERSION = 1;

export function workspaceRegistryPath(): string {
	return process.env.BACKLOG_WORKSPACES_FILE?.trim() || join(homedir(), ".backlog", "workspaces.json");
}

function normalizedRoot(input: string): string {
	if (!isAbsolute(input)) throw new Error("Workspace rootPath must be an absolute path.");
	const normalized = normalize(input);
	const root = parse(normalized).root;
	return normalized !== root && normalized.endsWith(sep) ? normalized.slice(0, -1) : normalized;
}

function rootKey(input: string): string {
	const normalized = normalizedRoot(input);
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateEntry(value: unknown, index: number): WorkspaceEntry {
	if (!isRecord(value)) throw new Error(`Workspace registry entry ${index + 1} must be an object.`);
	if (typeof value.id !== "string" || !/^[A-Za-z][A-Za-z0-9._-]*$/.test(value.id)) {
		throw new Error(`Workspace registry entry ${index + 1} has an invalid id.`);
	}
	if (typeof value.name !== "string" || value.name.trim() === "") {
		throw new Error(`Workspace registry entry ${index + 1} must have a nonblank name.`);
	}
	if (typeof value.rootPath !== "string")
		throw new Error(`Workspace registry entry ${index + 1} has an invalid rootPath.`);
	const rootPath = normalizedRoot(value.rootPath);
	if (typeof value.writable !== "boolean") {
		throw new Error(`Workspace registry entry ${index + 1} writable must be a boolean.`);
	}
	return { id: value.id, name: value.name.trim(), rootPath, writable: value.writable };
}

function validateFile(value: unknown): WorkspaceFile {
	if (!isRecord(value) || value.version !== REGISTRY_VERSION || !Array.isArray(value.workspaces)) {
		throw new Error(`Workspace registry must have version ${REGISTRY_VERSION} and a workspaces array.`);
	}
	const workspaces = value.workspaces.map(validateEntry);
	const ids = new Set<string>();
	const roots = new Set<string>();
	for (const workspace of workspaces) {
		const key = rootKey(workspace.rootPath);
		if (ids.has(workspace.id)) throw new Error(`Workspace registry contains duplicate id: ${workspace.id}`);
		if (roots.has(key)) throw new Error(`Workspace registry contains duplicate rootPath: ${workspace.rootPath}`);
		ids.add(workspace.id);
		roots.add(key);
	}
	return { version: REGISTRY_VERSION, workspaces };
}

async function loadFile(): Promise<WorkspaceFile> {
	try {
		return validateFile(JSON.parse(await readFile(workspaceRegistryPath(), "utf8")));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: REGISTRY_VERSION, workspaces: [] };
		if (error instanceof SyntaxError) throw new Error(`Workspace registry contains invalid JSON: ${error.message}`);
		throw error;
	}
}

async function saveFile(file: WorkspaceFile): Promise<void> {
	const path = workspaceRegistryPath();
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, "utf8");
		await rename(temporary, path);
	} finally {
		await unlink(temporary).catch(() => undefined);
	}
}

async function withRegistryLock<T>(operation: () => Promise<T>): Promise<T> {
	const path = workspaceRegistryPath();
	await mkdir(dirname(path), { recursive: true });
	const release = await lockfile.lock(path, {
		lockfilePath: `${path}.lock`,
		realpath: false,
		stale: 10_000,
		retries: { retries: 20, factor: 1, minTimeout: 25, maxTimeout: 25, randomize: false },
	});
	try {
		return await operation();
	} finally {
		await release();
	}
}

async function canonicalRoot(input: string): Promise<string> {
	const candidate = resolve(input);
	try {
		const info = await stat(candidate);
		if (!info.isDirectory()) throw new Error(`Workspace root is not a directory: ${input}`);
		return normalizedRoot(await realpath(candidate));
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("Workspace root")) throw error;
		throw new Error(`Workspace root is inaccessible: ${input}`);
	}
}

async function configurationError(rootPath: string): Promise<string | undefined> {
	try {
		if (!(await stat(rootPath)).isDirectory()) return "Workspace root is not a directory.";
	} catch {
		return "Workspace root is inaccessible.";
	}
	try {
		const resolution = resolveBacklogDirectory(rootPath);
		if (!resolution.configPath || !resolution.backlogPath) {
			return "Directory is not an initialized Backlog.md project. Initialize it with 'backlog init' or 'backlog init --no-git'.";
		}
		await access(resolution.configPath);
		return undefined;
	} catch {
		return "Backlog configuration is inaccessible.";
	}
}

export async function listWorkspaces(): Promise<WorkspaceListEntry[]> {
	const file = await withRegistryLock(loadFile);
	return await Promise.all(
		file.workspaces.map(async (workspace) => {
			const error = await configurationError(workspace.rootPath);
			return error ? { ...workspace, error } : workspace;
		}),
	);
}

export async function registerWorkspace(input: {
	id: string;
	name?: string;
	rootPath: string;
	writable?: boolean;
}): Promise<WorkspaceEntry> {
	if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(input.id)) {
		throw new Error("Workspace id must start with a letter and contain only letters, numbers, '.', '_' or '-'.");
	}
	if (input.writable !== undefined && typeof input.writable !== "boolean")
		throw new Error("Workspace writable must be a strict boolean.");
	const rootPath = await canonicalRoot(input.rootPath);
	const error = await configurationError(rootPath);
	if (error) throw new Error(`${error} Root: ${rootPath}`);
	return await withRegistryLock(async () => {
		const file = await loadFile();
		if (file.workspaces.some((workspace) => workspace.id === input.id))
			throw new Error(`Workspace id already exists: ${input.id}`);
		if (file.workspaces.some((workspace) => rootKey(workspace.rootPath) === rootKey(rootPath)))
			throw new Error(`Workspace root already exists: ${rootPath}`);
		const entry = { id: input.id, name: input.name?.trim() || input.id, rootPath, writable: input.writable ?? false };
		file.workspaces.push(entry);
		file.workspaces.sort((left, right) => left.id.localeCompare(right.id));
		await saveFile(file);
		return entry;
	});
}

export async function updateWorkspace(
	id: string,
	changes: { name?: string; writable?: boolean },
): Promise<WorkspaceEntry> {
	if (changes.writable !== undefined && typeof changes.writable !== "boolean")
		throw new Error("Workspace writable must be a strict boolean.");
	return await withRegistryLock(async () => {
		const file = await loadFile();
		const entry = file.workspaces.find((workspace) => workspace.id === id);
		if (!entry) throw new Error(`Workspace not found: ${id}`);
		if (changes.name !== undefined) {
			if (!changes.name.trim()) throw new Error("Workspace name must not be blank.");
			entry.name = changes.name.trim();
		}
		if (changes.writable !== undefined) entry.writable = changes.writable;
		await saveFile(file);
		return entry;
	});
}

export async function removeWorkspace(id: string): Promise<void> {
	await withRegistryLock(async () => {
		const file = await loadFile();
		const remaining = file.workspaces.filter((workspace) => workspace.id !== id);
		if (remaining.length === file.workspaces.length) throw new Error(`Workspace not found: ${id}`);
		file.workspaces = remaining;
		await saveFile(file);
	});
}
