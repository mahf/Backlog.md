import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { registerWorkspace, removeWorkspace } from "../core/workspace-registry.ts";
import { createMcpServer } from "../mcp/server.ts";
import { initializeFilesystemTestProject } from "./test-utils.ts";

let root: string;
let workspaceIds: string[] = [];
let server: Awaited<ReturnType<typeof createMcpServer>>;

async function project(name: string): Promise<string> {
	const path = await mkdtemp(join(root, `${name}-`));
	const core = new Core(path);
	await initializeFilesystemTestProject(core, name);
	await core.createTaskFromInput({ title: "Same task" });
	core.disposeContentStore();
	core.disposeSearchService();
	return path;
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "backlog-mcp-workspaces-"));
	process.env.BACKLOG_WORKSPACES_FILE = join(root, "registry.json");
	workspaceIds = [];
});

afterEach(async () => {
	await server?.stop();
	for (const id of workspaceIds) await removeWorkspace(id).catch(() => undefined);
	delete process.env.BACKLOG_WORKSPACES_FILE;
	await rm(root, { recursive: true, force: true });
});

describe("MCP workspace routing", () => {
	it("keeps same-ID views and edits isolated by registered workspace", async () => {
		const one = await project("one");
		const two = await project("two");
		await registerWorkspace({ id: "one", rootPath: one, writable: true });
		await registerWorkspace({ id: "two", rootPath: two, writable: true });
		workspaceIds = ["one", "two"];
		server = await createMcpServer(one, { pinned: true });
		const view = await server.testInterface.callTool({
			params: { name: "task_view", arguments: { id: "TASK-1", workspaceId: "two" } },
		});
		expect(view.content[0]?.type).toBe("text");
		expect(view.content[0]?.type === "text" ? view.content[0].text : "").toContain("workspaceId=two");
		await server.testInterface.callTool({
			params: { name: "task_edit", arguments: { id: "TASK-1", title: "Only two changed", workspaceId: "two" } },
		});
		const local = await server.testInterface.callTool({
			params: { name: "task_view", arguments: { id: "TASK-1", workspaceId: "one" } },
		});
		const remote = await server.testInterface.callTool({
			params: { name: "task_view", arguments: { id: "TASK-1", workspaceId: "two" } },
		});
		expect(local.content[0]?.type === "text" ? local.content[0].text : "").toContain("Same task");
		expect(remote.content[0]?.type === "text" ? remote.content[0].text : "").toContain("Only two changed");
	});

	it("rejects readonly targets and aggregates task lists with root errors", async () => {
		const one = await project("one");
		const two = await project("two");
		await registerWorkspace({ id: "one", rootPath: one, writable: false });
		await registerWorkspace({ id: "two", rootPath: two, writable: false });
		workspaceIds = ["one", "two"];
		server = await createMcpServer(one, { pinned: true });
		await expect(
			server.testInterface.callTool({
				params: { name: "task_edit", arguments: { id: "TASK-1", title: "blocked", workspaceId: "two" } },
			}),
		).rejects.toThrow("read-only");
		await expect(
			server.testInterface.callTool({
				params: { name: "document_create", arguments: { title: "blocked", content: "x" } },
			}),
		).rejects.toThrow("read-only");
		const aggregate = await server.testInterface.callTool({
			params: { name: "task_list", arguments: { allWorkspaces: true } },
		});
		const text = aggregate.content.map((item) => (item.type === "text" ? item.text : "")).join("\n");
		expect(text).toContain("workspaceId=one");
		expect(text).toContain("workspaceId=two");
		await rm(two, { recursive: true, force: true });
		const offline = await server.testInterface.callTool({
			params: { name: "task_list", arguments: { allWorkspaces: true } },
		});
		expect(offline.content.some((item) => item.type === "text" && item.text.includes("workspaceId=two"))).toBe(true);
		await expect(
			server.testInterface.callTool({
				params: { name: "task_view", arguments: { id: "TASK-1", workspaceId: "missing" } },
			}),
		).rejects.toThrow("Workspace not found");
	});
});
