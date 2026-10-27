import type { Command } from "commander";
import { listWorkspaces, registerWorkspace, removeWorkspace, updateWorkspace } from "../core/workspace-registry.ts";

function booleanOption(value: string): boolean {
	if (value === "true") return true;
	if (value === "false") return false;
	throw new Error("Expected true or false.");
}

function output(value: unknown, json: boolean): void {
	if (json) {
		console.log(JSON.stringify(value, null, 2));
		return;
	}
	if (Array.isArray(value)) {
		console.log(
			value
				.map(
					(entry) =>
						`${entry.id}\t${entry.name}\t${entry.rootPath}\t${entry.writable}${entry.error ? `\tERROR: ${entry.error}` : ""}`,
				)
				.join("\n"),
		);
		return;
	}
	if ((value as { removed?: boolean }).removed) {
		console.log(`${(value as { id: string }).id}\tremoved`);
		return;
	}
	console.log(`${(value as { id: string }).id}\t${(value as { name: string }).name}`);
}

export function registerWorkspaceCommand(program: Command): void {
	const workspace = program
		.command("workspace")
		.description("Manage registered project roots (separate from task --project categories)");
	workspace
		.command("register <rootPath>")
		.description("Register an initialized Backlog.md project without changing its files")
		.requiredOption("--id <id>", "stable workspace identifier")
		.option("--name <name>", "display name")
		.option("--writable <boolean>", "strict boolean write permission: true or false (default: false)")
		.option("--json", "print machine-readable JSON")
		.action(async (rootPath: string, options: { id: string; name?: string; writable?: string; json?: boolean }) => {
			output(
				await registerWorkspace({
					id: options.id,
					name: options.name ?? options.id,
					rootPath,
					writable: options.writable === undefined ? false : booleanOption(options.writable),
				}),
				Boolean(options.json),
			);
		});
	workspace
		.command("list")
		.description("List registered project roots")
		.option("--json", "print machine-readable JSON")
		.action(async (options: { json?: boolean }) => output(await listWorkspaces(), Boolean(options.json)));
	workspace
		.command("edit <id>")
		.description("Change a workspace display name or write permission")
		.option("--name <name>", "display name")
		.option("--writable <boolean>", "strict boolean write permission: true or false")
		.option("--json", "print machine-readable JSON")
		.action(async (id: string, options: { name?: string; writable?: string; json?: boolean }) =>
			output(
				await updateWorkspace(id, {
					name: options.name,
					writable: options.writable === undefined ? undefined : booleanOption(options.writable),
				}),
				Boolean(options.json),
			),
		);
	workspace
		.command("remove <id>")
		.description("Remove a registration without changing project files")
		.option("--json", "print machine-readable JSON")
		.action(async (id: string, options: { json?: boolean }) => {
			await removeWorkspace(id);
			output({ id, removed: true }, Boolean(options.json));
		});
}
