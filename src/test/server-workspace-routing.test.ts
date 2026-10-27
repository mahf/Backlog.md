import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { runWorkflow } from "../core/workflow-adapter.ts";
import { registerWorkspace, removeWorkspace } from "../core/workspace-registry.ts";
import { BacklogServer } from "../server/index.ts";
import { initializeFilesystemTestProject } from "./test-utils.ts";

let root: string;
let server: BacklogServer;
let workspaceIds: string[] = [];
const rqPath = process.env.BACKLOG_RQ_PATH?.trim() || "C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/tools/rq.py";

async function createProject(name: string): Promise<string> {
	const path = await mkdtemp(join(root, `${name}-`));
	const core = new Core(path);
	await initializeFilesystemTestProject(core, name);
	await core.createTaskFromInput({ title: "Same task" });
	core.disposeContentStore();
	core.disposeSearchService();
	return path;
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "backlog-http-workspaces-"));
	process.env.BACKLOG_WORKSPACES_FILE = join(root, "registry.json");
	workspaceIds = [];
});

afterEach(async () => {
	await server?.stop();
	for (const id of workspaceIds) await removeWorkspace(id).catch(() => undefined);
	delete process.env.BACKLOG_WORKSPACES_FILE;
	await rm(root, { recursive: true, force: true });
});

describe("BacklogServer workspace routing", () => {
	it("reads and edits the selected workspace without changing the server root", async () => {
		const projectA = await createProject("Project A");
		const projectB = await createProject("Project B");
		await registerWorkspace({ id: "a", rootPath: projectA, writable: true });
		await registerWorkspace({ id: "b", rootPath: projectB, writable: true });
		workspaceIds = ["a", "b"];

		server = new BacklogServer(projectA);
		await server.start(0, false);
		const base = `http://127.0.0.1:${server.getPort()}`;
		const selected = await fetch(`${base}/api/tasks/TASK-1?workspace=b`);
		expect(selected.status).toBe(200);
		const selectedJson = await selected.json();
		expect(selectedJson.title).toBe("Same task");
		expect(selectedJson.workspaceId).toBe("b");

		const update = await fetch(`${base}/api/tasks/TASK-1?workspace=b`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ title: "Only B changed", workspaceId: "b" }),
		});
		expect(update.status).toBe(200);
		const local = await fetch(`${base}/api/tasks/TASK-1?workspace=a`);
		expect((await local.json()).title).toBe("Same task");
		const remote = await fetch(`${base}/api/tasks/TASK-1?workspace=b`);
		expect((await remote.json()).title).toBe("Only B changed");
	});

	it("forwards external edits from multiple workspaces to the parent socket", async () => {
		const projectA = await createProject("Project A");
		const projectB = await createProject("Project B");
		await registerWorkspace({ id: "a", rootPath: projectA, writable: true });
		await registerWorkspace({ id: "b", rootPath: projectB, writable: true });
		workspaceIds = ["a", "b"];
		server = new BacklogServer(projectA);
		await server.start(0, false);
		const base = `http://127.0.0.1:${server.getPort()}`;
		await fetch(`${base}/api/tasks?workspace=a`);
		await fetch(`${base}/api/tasks?workspace=b`);
		const messages: string[] = [];
		const socket = new WebSocket(`ws://127.0.0.1:${server.getPort()}`);
		socket.onmessage = (event) => messages.push(String(event.data));
		await new Promise<void>((resolve, reject) => {
			socket.onopen = () => resolve();
			socket.onerror = () => reject(new Error("WebSocket failed to open"));
		});
		await writeFile(join(projectA, "backlog", "tasks", "task-1.md"), "external A", "utf8");
		await writeFile(join(projectB, "backlog", "tasks", "task-1.md"), "external B", "utf8");
		await new Promise((resolve) => setTimeout(resolve, 250));
		socket.close();
		expect(
			messages.some((message) => {
				if (message === "tasks-updated") return true;
				try {
					return (JSON.parse(message) as { type?: string; workspaceId?: string }).type === "tasks-updated";
				} catch {
					return false;
				}
			}),
		).toBe(true);
	});

	it("fails closed for aggregate mutations and unknown workspace ids", async () => {
		const projectA = await createProject("Project A");
		const projectB = await createProject("Project B");
		await registerWorkspace({ id: "a", rootPath: projectA, writable: true });
		await registerWorkspace({ id: "b", rootPath: projectB, writable: false });
		workspaceIds = ["a", "b"];
		server = new BacklogServer(projectA);
		await server.start(0, false);
		const base = `http://127.0.0.1:${server.getPort()}`;
		const aggregate = await fetch(`${base}/api/tasks/reorder?allWorkspaces=true`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ title: "view" }),
		});
		expect(aggregate.status).toBe(409);
		const readonly = await fetch(`${base}/api/tasks/TASK-1?workspace=b`, {
			method: "PUT",
			body: JSON.stringify({ title: "readOnly title" }),
		});
		expect(readonly.status).toBe(403);
		const readonlyDetail = await fetch(`${base}/api/tasks/TASK-1?workspace=b`);
		expect((await readonlyDetail.json()).workspaceId).toBe("b");
		const missing = await fetch(`${base}/api/tasks/TASK-1?workspace=missing`);
		expect(missing.status).toBe(404);
	});

	it("returns a usable disabled workflow result and validates mutation fields", async () => {
		const projectA = await createProject("Project A");
		await registerWorkspace({ id: "a", rootPath: projectA, writable: true });
		workspaceIds = ["a"];
		server = new BacklogServer(projectA);
		await server.start(0, false);
		const base = `http://127.0.0.1:${server.getPort()}`;
		const snapshot = await fetch(`${base}/api/workflow`);
		expect(snapshot.status).toBe(200);
		expect((await snapshot.json()).ok).toBe(false);
		const response = await fetch(`${base}/api/workflow/respond?workspace=a`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ requestId: "REQ-1" }),
		});
		expect(response.status).toBe(400);
	});

	it("serves workflow deep links through the SPA", async () => {
		const projectA = await createProject("Project A");
		server = new BacklogServer(projectA);
		await server.start(0, false);
		const base = `http://127.0.0.1:${server.getPort()}`;

		for (const path of ["/workflow", "/workflow/request-1", "/human-inbox"]) {
			const response = await fetch(`${base}${path}`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/html");
		}
	});

	it("serves and answers an isolated rq request through HTTP", async () => {
		const projectA = await createProject("Workflow Project");
		await mkdir(join(projectA, "backlog", "specs"), { recursive: true });
		await writeFile(join(projectA, "backlog", "specs", "question.md"), "# Question\n", "utf8");
		const configCore = new Core(projectA);
		const config = await configCore.filesystem.loadConfig();
		if (!config) throw new Error("Test project config was not initialized");
		await configCore.filesystem.saveConfig({ ...config, workflow: { enabled: true, rqPath } });
		configCore.disposeContentStore();
		configCore.disposeSearchService();
		const options = { root: projectA, enabled: true, rq: rqPath };
		const created = await runWorkflow(
			[
				"request",
				"-",
				"decision",
				"Choose a policy",
				"--subject-key",
				"backlog/specs/question.md",
				"--request-id",
				"HTTP-1",
			],
			options,
		);
		expect(created.exitCode).toBe(0);
		await registerWorkspace({ id: "workflow", rootPath: projectA, writable: true });
		workspaceIds = ["workflow"];
		server = new BacklogServer(projectA);
		await server.start(0, false);
		const base = `http://127.0.0.1:${server.getPort()}`;
		const board = await fetch(`${base}/api/workflow?workspace=workflow`);
		const boardJson = await board.json();
		expect(boardJson.ok).toBe(true);
		expect(boardJson.data.requests[0].workspaceId).toBe("workflow");
		const requestId = boardJson.data.requests[0].request_id;
		const material = await fetch(`${base}/api/workflow/material?workspace=workflow&path=backlog/specs/question.md`);
		expect(material.status).toBe(200);
		expect((await material.json()).content).toContain("Question");
		const materialFixtureLimitations: string[] = [];

		const directoryPath = "backlog/specs/material-directory";
		await mkdir(join(projectA, directoryPath), { recursive: true });
		const directoryRequest = await runWorkflow(
			[
				"request",
				"-",
				"decision",
				"Preview a directory material target",
				"--subject-key",
				directoryPath,
				"--request-id",
				"HTTP-DIR-MATERIAL",
			],
			options,
		);
		if (directoryRequest.exitCode === 0) {
			const directoryBoard = await fetch(`${base}/api/workflow?workspace=workflow`);
			const directoryBoardJson = await directoryBoard.json();
			const directoryRequestRecord = directoryBoardJson.data.requests.find(
				(request: { request_id?: string }) => request.request_id === "HTTP-DIR-MATERIAL",
			);
			if (directoryRequestRecord?.preview?.includes(directoryPath)) {
				const directoryMaterial = await fetch(
					`${base}/api/workflow/material?workspace=workflow&path=${encodeURIComponent(directoryPath)}`,
				);
				expect(directoryMaterial.status).toBe(403);
			} else materialFixtureLimitations.push("rq did not include the directory target in preview");
		} else materialFixtureLimitations.push("rq rejected the directory target request");

		const outsidePath = join(root, "outside-material.md");
		const aliasPath = "backlog/specs/outside-alias.md";
		await writeFile(outsidePath, "outside", "utf8");
		let symlinkSupported = true;
		try {
			await symlink(outsidePath, join(projectA, aliasPath), "file");
		} catch {
			symlinkSupported = false;
			materialFixtureLimitations.push("symlink creation is unavailable in this Windows test environment");
		}
		if (symlinkSupported) {
			const aliasRequest = await runWorkflow(
				[
					"request",
					"-",
					"decision",
					"Preview a symlink material target",
					"--subject-key",
					aliasPath,
					"--request-id",
					"HTTP-SYMLINK-MATERIAL",
				],
				options,
			);
			if (aliasRequest.exitCode === 0) {
				const aliasBoard = await fetch(`${base}/api/workflow?workspace=workflow`);
				const aliasBoardJson = await aliasBoard.json();
				const aliasRequestRecord = aliasBoardJson.data.requests.find(
					(request: { request_id?: string }) => request.request_id === "HTTP-SYMLINK-MATERIAL",
				);
				if (aliasRequestRecord?.preview?.includes(aliasPath)) {
					const aliasMaterial = await fetch(
						`${base}/api/workflow/material?workspace=workflow&path=${encodeURIComponent(aliasPath)}`,
					);
					expect(aliasMaterial.status).toBe(403);
				} else materialFixtureLimitations.push("rq did not include the symlink target in preview");
			} else materialFixtureLimitations.push("rq rejected the symlink target request");
		}
		if (materialFixtureLimitations.length > 0)
			console.info(`Material fixture limitations: ${materialFixtureLimitations.join("; ")}`);
		const response = await fetch(`${base}/api/workflow/respond?workspace=workflow`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				requestId,
				reply: "Keep it",
				action: "answer",
				expectedRevision: "",
				idempotencyKey: "http-1",
			}),
		});
		const responseJson = await response.json();
		expect(response.status).toBe(200);
		expect(responseJson.saved).toBe(true);
	});

	it("rejects approved directory and outside symlink materials over HTTP", async () => {
		const projectA = await createProject("Bounded Material Project");
		const approvedPath = "backlog/specs/approved.md";
		const directoryPath = "backlog/specs/material-directory";
		const aliasPath = "backlog/specs/outside-alias.md";
		await mkdir(join(projectA, "backlog", "specs"), { recursive: true });
		await writeFile(join(projectA, approvedPath), "approved material", "utf8");
		await mkdir(join(projectA, directoryPath), { recursive: true });
		const outsidePath = join(root, "bounded-outside.md");
		await writeFile(outsidePath, "outside material", "utf8");
		let hasSymlink = true;
		try {
			await symlink(outsidePath, join(projectA, aliasPath), "file");
		} catch {
			hasSymlink = false;
		}
		const adapterPath = join(root, "bounded-rq-adapter.py");
		await writeFile(
			adapterPath,
			[
				"import json",
				'print(json.dumps({"schema_version": 1, "tasks": [{"preview": ["backlog/specs/approved.md", "backlog/specs/material-directory", "backlog/specs/outside-alias.md"]}]}))',
			].join("\n"),
			"utf8",
		);
		const configCore = new Core(projectA);
		const config = await configCore.filesystem.loadConfig();
		if (!config) throw new Error("Test project config was not initialized");
		await configCore.filesystem.saveConfig({ ...config, workflow: { enabled: true, rqPath: adapterPath } });
		configCore.disposeContentStore();
		configCore.disposeSearchService();
		await registerWorkspace({ id: "bounded", rootPath: projectA, writable: true });
		workspaceIds = ["bounded"];
		server = new BacklogServer(projectA);
		await server.start(0, false);
		const base = `http://127.0.0.1:${server.getPort()}`;
		const approved = await fetch(
			`${base}/api/workflow/material?workspace=bounded&path=${encodeURIComponent(approvedPath)}`,
		);
		expect(approved.status).toBe(200);
		expect((await approved.json()).content).toBe("approved material");
		const directory = await fetch(
			`${base}/api/workflow/material?workspace=bounded&path=${encodeURIComponent(directoryPath)}`,
		);
		expect(directory.status).toBe(403);
		if (hasSymlink) {
			const alias = await fetch(
				`${base}/api/workflow/material?workspace=bounded&path=${encodeURIComponent(aliasPath)}`,
			);
			expect(alias.status).toBe(403);
		} else console.info("Material fixture limitation: symlink creation unavailable; directory HTTP rejection covered");
	});
});
