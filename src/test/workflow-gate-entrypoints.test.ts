import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../core/backlog.ts";
import { McpServer } from "../mcp/server.ts";
import { registerTaskTools } from "../mcp/tools/tasks/index.ts";
import { BacklogServer } from "../server/index.ts";
import { initializeFilesystemTestProject } from "./test-utils.ts";

const roots: string[] = [];
const rqScript = `import json, sys
if "board" in sys.argv:
    print(json.dumps({"tasks": [{"original_id": "task-1", "source_type": "backlog-task"}], "requests": [{"ticket": "task-1", "source_type": "backlog-task", "status": "pending"}]}))
else:
    print("invalid or pending workflow evidence", file=sys.stderr)
    sys.exit(1)
`;

async function fixture(): Promise<{ root: string; core: Core }> {
	const root = await mkdtemp(join(tmpdir(), "backlog-workflow-entrypoints-中文-"));
	roots.push(root);
	const core = new Core(root);
	await initializeFilesystemTestProject(core, "Entrypoint fixture");
	await core.createTask({
		id: "task-1",
		title: "Pending task",
		status: "To Do",
		assignee: [],
		labels: [],
		dependencies: [],
		createdDate: "2026-10-26",
	});
	const rqPath = join(root, "rq-fixture.py");
	await writeFile(rqPath, rqScript, "utf8");
	const config = await core.filesystem.loadConfig();
	if (!config) throw new Error("fixture config missing");
	config.workflow = { enabled: true, rqPath, pythonPath: "python" };
	await core.filesystem.saveConfig(config);
	return { root, core };
}

function resultText(result: { content?: Array<{ type: string; text?: string }> }): string {
	return (result.content ?? []).map((entry) => entry.text ?? "").join("\n");
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("workflow gate public entrypoints", () => {
	it("blocks HTTP and MCP terminal edits while a request is pending", async () => {
		const { root, core } = await fixture();
		const server = new BacklogServer(root);
		const mcp = new McpServer(root, "test");
		await mcp.filesystem.ensureBacklogStructure();
		const config = await mcp.filesystem.loadConfig();
		if (!config) throw new Error("MCP fixture config missing");
		registerTaskTools(mcp, config);
		await server.start(0, false);
		try {
			const port = server.getPort();
			if (!port) throw new Error("server did not start");
			const task = await core.filesystem.loadTask("task-1");
			if (!task) throw new Error("fixture task missing");
			const http = await fetch(`http://127.0.0.1:${port}/api/tasks/task-1`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...task, status: "Done" }),
			});
			expect(http.ok).toBe(false);
			expect((await core.filesystem.loadTask("task-1"))?.status).toBe("To Do");

			const mcpResult = await mcp.testInterface.callTool({
				params: { name: "task_edit", arguments: { id: "task-1", status: "Done" } },
			});
			expect(mcpResult.isError).toBe(true);
			expect(resultText(mcpResult)).toContain("unresolved workflow request");
			expect((await core.filesystem.loadTask("task-1"))?.status).toBe("To Do");
		} finally {
			await server.stop();
			await mcp.stop();
		}
	});

	it("blocks CLI terminal edits with invalid evidence and keeps material unchanged", async () => {
		const { root, core } = await fixture();
		const rqPath = join(root, "rq-fixture.py");
		await writeFile(
			rqPath,
			`import json, sys\nif "board" in sys.argv:\n print(json.dumps({"tasks":[{"original_id":"task-1","source_type":"backlog-task"}],"requests":[]}))\nelse:\n print("invalid approval", file=sys.stderr)\n sys.exit(1)\n`,
			"utf8",
		);
		const before = await readFile((await core.filesystem.loadTask("task-1"))?.filePath ?? "", "utf8");
		const cli =
			await $`bun ${join(import.meta.dir, "..", "cli.ts")} task edit task-1 --status Done --description changed --plain`
				.cwd(root)
				.nothrow()
				.quiet();
		expect(cli.exitCode).not.toBe(0);
		expect(`${cli.stdout}${cli.stderr}`).toContain("Workflow gate rejected");
		expect((await core.filesystem.loadTask("task-1"))?.status).toBe("To Do");
		const after = await readFile((await core.filesystem.loadTask("task-1"))?.filePath ?? "", "utf8");
		expect(after).toBe(before);
	});

	it("protects both demotion paths and direct draft promotion", async () => {
		const { root, core } = await fixture();
		await expect(core.demoteTask("task-1", false)).rejects.toThrow("unresolved workflow request");
		await expect(core.updateTaskFromInput("task-1", { status: "Draft" }, false)).rejects.toThrow(
			"unresolved workflow request",
		);
		expect(await core.filesystem.loadTask("task-1")).not.toBeNull();

		const draftResult = await core.createTaskFromInput({ title: "Terminal draft", status: "Draft" }, false);
		await core.filesystem.saveDraft({ ...draftResult.task, status: "Done" });
		const config = await core.filesystem.loadConfig();
		if (!config) throw new Error("fixture config missing");
		config.workflow = { enabled: true, rqPath: join(root, "rq-empty.py"), pythonPath: "python" };
		await writeFile(
			join(root, "rq-empty.py"),
			`import json, sys\nif "board" in sys.argv:\n print(json.dumps({"tasks":[],"requests":[]}))\nelse:\n sys.exit(1)\n`,
			"utf8",
		);
		await core.filesystem.saveConfig(config);
		await expect(core.promoteDraft(draftResult.task.id, false)).rejects.toThrow(
			"establish the task in a non-terminal status",
		);
		expect(await core.filesystem.loadDraft(draftResult.task.id)).not.toBeNull();
	});
});
