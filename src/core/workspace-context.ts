import { realpath } from "node:fs/promises";
import { findBacklogRoot } from "../utils/find-backlog-root.ts";
import { listWorkspaces, type WorkspaceEntry, type WorkspaceListEntry } from "./workspace-registry.ts";

export type WorkspaceSelection = {
	workspace?: string;
	allWorkspaces?: boolean;
};

export async function listQueryWorkspaces(): Promise<WorkspaceListEntry[]> {
	return await listWorkspaces();
}

export async function resolveWorkspaceRoot(
	selection: WorkspaceSelection,
	currentDirectory: string,
): Promise<{ rootPath: string; workspace?: WorkspaceEntry }> {
	if (selection.allWorkspaces) {
		throw new Error("--all-workspaces is only available to aggregate task queries.");
	}
	if (!selection.workspace) {
		const rootPath = await findBacklogRoot(currentDirectory);
		if (!rootPath) throw new Error("No Backlog.md project found. Run `backlog init` to initialize.");
		const canonical = await realpath(rootPath);
		const key = process.platform === "win32" ? canonical.toLowerCase() : canonical;
		const registered = (await listWorkspaces()).find((entry) => {
			const registeredKey = process.platform === "win32" ? entry.rootPath.toLowerCase() : entry.rootPath;
			return registeredKey === key;
		});
		if (registered?.error) throw new Error(`Workspace ${registered.id} is unavailable: ${registered.error}`);
		return registered ? { rootPath: registered.rootPath, workspace: registered } : { rootPath: canonical };
	}

	const workspace = (await listWorkspaces()).find((entry) => entry.id === selection.workspace);
	if (!workspace) throw new Error(`Workspace not found: ${selection.workspace}`);
	if (workspace.error) throw new Error(`Workspace ${workspace.id} is unavailable: ${workspace.error}`);
	return { rootPath: workspace.rootPath, workspace };
}

export function assertWorkspaceWritable(workspace: WorkspaceEntry | undefined, command: string): void {
	if (workspace && !workspace.writable) {
		throw new Error(`Workspace ${workspace.id} is read-only; cannot run ${command}.`);
	}
}

export function assertAggregateReadOnly(allWorkspaces: boolean, command: string): void {
	if (allWorkspaces) throw new Error(`--all-workspaces cannot be used with ${command}; choose --workspace for writes.`);
}

export function isReadOnlyCliInvocation(args: readonly string[]): boolean {
	let index = 0;
	while (index < args.length && args[index]?.startsWith("-")) {
		const option = args[index] ?? "";
		index += option === "--workspace" ? 2 : 1;
	}
	const command = args[index] ?? "command";
	let action = command;
	if (
		[
			"task",
			"tasks",
			"config",
			"doc",
			"document",
			"documents",
			"decision",
			"decisions",
			"milestone",
			"milestones",
		].includes(command.toLowerCase())
	) {
		let actionIndex = index + 1;
		while (actionIndex < args.length && args[actionIndex]?.startsWith("-")) {
			actionIndex += args[actionIndex] === "--workspace" ? 2 : 1;
		}
		action = args[actionIndex] ?? "command";
	}
	const commandName = command.toLowerCase();
	const readActions = new Map<string, Set<string>>([
		["task", new Set(["list", "search", "view", "show", "status", "stats", "statistics"])],
		["tasks", new Set(["list", "search", "view", "show", "status", "stats", "statistics"])],
		["config", new Set(["list", "get"])],
		["document", new Set(["list", "search", "view", "show"])],
		["doc", new Set(["list", "search", "view", "show"])],
		["documents", new Set(["list", "search", "view", "show"])],
		["decision", new Set(["list", "search", "view", "show"])],
		["decisions", new Set(["list", "search", "view", "show"])],
		["milestone", new Set(["list", "view", "show"])],
		["milestones", new Set(["list", "view", "show"])],
		["search", new Set(["search"])],
		["board", new Set(["board"])],
		["help", new Set(["help"])],
		["version", new Set(["version"])],
	]);
	return readActions.get(commandName)?.has(action.toLowerCase()) ?? false;
}
