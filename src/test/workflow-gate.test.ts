import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { runWorkflow } from "../core/workflow-adapter.ts";
import { assertWorkflowTerminalTransition } from "../core/workflow-gate.ts";
import type { Task } from "../types/index.ts";
import { initializeFilesystemTestProject } from "./test-utils.ts";

const roots: string[] = [];
const nativeIntegration = it.skipIf(!process.env.BACKLOG_RQ_PATH?.trim());

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("workflow completion gate", () => {
	async function configureBoardFixture(core: Core, root: string, board: object): Promise<void> {
		const rqPath = join(root, "rq-fixture.py");
		await writeFile(rqPath, `import sys\nprint(${JSON.stringify(JSON.stringify(board))})\n`);
		const config = await core.filesystem.loadConfig();
		if (!config) throw new Error("fixture config missing");
		config.workflow = { enabled: true, rqPath, pythonPath: process.env.BACKLOG_RQ_PYTHON || "python" };
		await core.filesystem.saveConfig(config);
	}

	nativeIntegration("accepts a valid low-risk native task and rejects material plus Done without writing", async () => {
		const root = await mkdtemp(join(tmpdir(), "backlog-workflow-gate-native-中文-"));
		roots.push(root);
		await mkdir(join(root, "backlog", "tasks"), { recursive: true });
		await mkdir(join(root, "backlog", "evidence", "T-001"), { recursive: true });
		await mkdir(join(root, "docs"), { recursive: true });
		await mkdir(join(root, "workflow"), { recursive: true });
		const core = new Core(root);
		await initializeFilesystemTestProject(core, "Native gate fixture");
		await writeFile(join(root, "workflow", "REVIEW-POLICY.md"), "```policy\nl1_default=none\n```\n");
		await writeFile(join(root, "docs", "a.md"), "original\n");
		const taskPath = join(root, "backlog", "tasks", "T-001-test.md");
		await writeFile(
			taskPath,
			"---\nid: T-001\ntitle: Native gate fixture\nstatus: In Progress\nmilestone: M1\n---\n# Native gate fixture\n\n## Dispatch\n| Complexity | L1 |\n| Human review | none |\n\n## Acceptance Assertions\n- [x] A1: document changes\n  - 功能结果: PASS\n\n## Touches\n- docs/a.md\n",
		);
		await writeFile(join(root, "backlog", "evidence", "T-001", "receipt.md"), "done\n");
		const config = await core.filesystem.loadConfig();
		if (!config) throw new Error("fixture config missing");
		config.workflow = {
			enabled: true,
			rqPath: process.env.BACKLOG_RQ_PATH,
			pythonPath: process.env.BACKLOG_RQ_PYTHON || "python",
		};
		await core.filesystem.saveConfig(config);
		const options = { root, rq: process.env.BACKLOG_RQ_PATH, enabled: true };
		expect((await runWorkflow(["changes", "T-001", "--path", "docs/a.md"], options)).exitCode).toBe(0);
		expect(
			(
				await runWorkflow(
					["run-check", "T-001", "--assertion", "A1", "--cwd", ".", "--", "python", "-c", "print(1)"],
					options,
				)
			).exitCode,
		).toBe(0);
		const previous = {
			id: "T-001",
			title: "Native gate fixture",
			status: "In Progress",
			milestone: "M1",
			description: "",
		} as Task;
		const next = { ...previous, status: "Done" };
		await assertWorkflowTerminalTransition(root, config, previous, next);
		expect((await runWorkflow(["accept", "--milestone", "M1"], options)).exitCode).toBe(0);
		const before = await Bun.file(taskPath).text();
		await expect(
			assertWorkflowTerminalTransition(root, config, previous, { ...next, description: "changed material" }),
		).rejects.toThrow("save delivery material");
		expect(await Bun.file(taskPath).text()).toBe(before);
	});

	it("rejects a terminal transition when enabled rq cannot run and leaves the task unchanged", async () => {
		const root = await mkdtemp(join(tmpdir(), "backlog-workflow-gate-"));
		roots.push(root);
		await mkdir(root, { recursive: true });
		const core = new Core(root);
		await initializeFilesystemTestProject(core, "Gate fixture");
		const config = await core.filesystem.loadConfig();
		if (!config) throw new Error("fixture config missing");
		await core.createTask({
			id: "task-1",
			title: "Gate task",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-26",
		});
		config.workflow = { enabled: true, rqPath: join(root, "missing-rq.exe") };
		await core.filesystem.saveConfig(config);
		const task = await core.filesystem.loadTask("task-1");
		if (!task) throw new Error("fixture task missing");
		await expect(core.updateTask({ ...task, status: "Done" })).rejects.toThrow("Workflow gate rejected");
		expect((await core.filesystem.loadTask("task-1"))?.status).toBe("To Do");
	});

	it("rejects creating a terminal task before rq has a board target", async () => {
		const root = await mkdtemp(join(tmpdir(), "backlog-workflow-gate-create-terminal-"));
		roots.push(root);
		const core = new Core(root);
		await initializeFilesystemTestProject(core, "Create terminal fixture");
		await configureBoardFixture(core, root, { tasks: [], requests: [] });
		await expect(
			core.createTask({
				id: "task-1",
				title: "Terminal task",
				status: "Done",
				assignee: [],
				labels: [],
				dependencies: [],
				createdDate: "2026-10-26",
			}),
		).rejects.toThrow("establish the task in a non-terminal status");
		expect(await core.filesystem.loadTask("task-1")).toBeNull();
	});

	it("rejects changing delivery material and entering Done in one update", async () => {
		const root = await mkdtemp(join(tmpdir(), "backlog-workflow-gate-material-done-"));
		roots.push(root);
		const core = new Core(root);
		await initializeFilesystemTestProject(core, "Material done fixture");
		await core.createTask({
			id: "task-1",
			title: "Material task",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-26",
		});
		await configureBoardFixture(core, root, {
			tasks: [{ original_id: "task-1", source_type: "backlog-task", status: "ready-for-agent" }],
			requests: [],
		});
		const task = await core.filesystem.loadTask("task-1");
		if (!task) throw new Error("fixture task missing");
		await expect(core.updateTask({ ...task, status: "Done", description: "new delivery" })).rejects.toThrow(
			"save delivery material before marking it complete",
		);
		expect((await core.filesystem.loadTask("task-1"))?.status).toBe("To Do");
	});

	it("rejects policy and scope changes with a terminal transition", async () => {
		const root = await mkdtemp(join(tmpdir(), "backlog-workflow-gate-policy-done-"));
		roots.push(root);
		const core = new Core(root);
		await initializeFilesystemTestProject(core, "Policy done fixture");
		await core.createTask({
			id: "task-1",
			title: "Policy task",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-26",
		});
		await configureBoardFixture(core, root, {
			tasks: [{ original_id: "task-1", source_type: "backlog-task" }],
			requests: [],
		});
		const task = await core.filesystem.loadTask("task-1");
		if (!task) throw new Error("fixture task missing");
		await expect(
			core.updateTask({ ...task, status: "Done", title: "Changed scope", milestone: "release-2" }),
		).rejects.toThrow("save delivery material before marking it complete");
		expect((await core.filesystem.loadTask("task-1"))?.status).toBe("To Do");
	});

	it("allows a status-only terminal transition after board identity validation", async () => {
		const root = await mkdtemp(join(tmpdir(), "backlog-workflow-gate-status-only-"));
		roots.push(root);
		const core = new Core(root);
		await initializeFilesystemTestProject(core, "Status only fixture");
		await core.createTask({
			id: "task-1",
			title: "Status task",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-26",
		});
		await configureBoardFixture(core, root, {
			tasks: [{ original_id: "task-1", source_type: "backlog-task" }],
			requests: [],
		});
		const task = await core.filesystem.loadTask("task-1");
		if (!task) throw new Error("fixture task missing");
		await core.updateTask({ ...task, status: "Done" });
		expect((await core.filesystem.loadTask("task-1"))?.status).toBe("Done");
	});

	it("applies the same terminal gate to bulk updates", async () => {
		const root = await mkdtemp(join(tmpdir(), "backlog-workflow-gate-bulk-"));
		roots.push(root);
		const core = new Core(root);
		await initializeFilesystemTestProject(core, "Bulk fixture");
		await core.createTask({
			id: "task-1",
			title: "Bulk one",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-26",
		});
		await core.createTask({
			id: "task-2",
			title: "Bulk two",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-26",
		});
		await configureBoardFixture(core, root, {
			tasks: [
				{ original_id: "task-1", source_type: "backlog-task" },
				{ original_id: "task-2", source_type: "backlog-task" },
			],
			requests: [],
		});
		const first = await core.filesystem.loadTask("task-1");
		const second = await core.filesystem.loadTask("task-2");
		if (!first || !second) throw new Error("bulk fixture task missing");
		await core.updateTasksBulk(
			[
				{ ...first, status: "Done" },
				{ ...second, status: "Done" },
			],
			undefined,
			false,
		);
		expect((await core.filesystem.loadTask("task-1"))?.status).toBe("Done");
		expect((await core.filesystem.loadTask("task-2"))?.status).toBe("Done");
	});

	it("surfaces a stale public approval and leaves the task unchanged", async () => {
		const root = await mkdtemp(join(tmpdir(), "backlog-workflow-gate-stale-"));
		roots.push(root);
		const core = new Core(root);
		await initializeFilesystemTestProject(core, "Stale fixture");
		await core.createTask({
			id: "task-1",
			title: "Stale task",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-26",
		});
		const rqPath = join(root, "rq-stale.py");
		await writeFile(
			rqPath,
			'import sys\nif \'board\' in sys.argv:\n print(\'{"tasks":[{"original_id":"task-1","source_type":"backlog-task"}],"requests":[]}\')\nelse:\n print(\'stale approval\', file=sys.stderr)\n sys.exit(1)\n',
		);
		const config = await core.filesystem.loadConfig();
		if (!config) throw new Error("fixture config missing");
		config.workflow = { enabled: true, rqPath, pythonPath: process.env.BACKLOG_RQ_PYTHON || "python" };
		await core.filesystem.saveConfig(config);
		const task = await core.filesystem.loadTask("task-1");
		if (!task) throw new Error("fixture task missing");
		await expect(core.updateTask({ ...task, status: "Done" })).rejects.toThrow("stale approval");
		expect((await core.filesystem.loadTask("task-1"))?.status).toBe("To Do");
	});

	it("keeps ordinary disabled projects unchanged", async () => {
		const root = await mkdtemp(join(tmpdir(), "backlog-workflow-disabled-"));
		roots.push(root);
		const core = new Core(root);
		await initializeFilesystemTestProject(core, "Disabled fixture");
		await core.createTask({
			id: "task-1",
			title: "Ordinary task",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-26",
		});
		const task = await core.filesystem.loadTask("task-1");
		if (!task) throw new Error("fixture task missing");
		await core.updateTask({ ...task, status: "Done" });
		expect((await core.filesystem.loadTask("task-1"))?.status).toBe("Done");
	});

	it("preserves metadata edits and permits reopening historical terminal tasks", async () => {
		const root = await mkdtemp(join(tmpdir(), "backlog-workflow-history-"));
		roots.push(root);
		const core = new Core(root);
		await initializeFilesystemTestProject(core, "History fixture");
		const config = await core.filesystem.loadConfig();
		if (!config) throw new Error("fixture config missing");
		await core.createTask({
			id: "task-1",
			title: "Historical task",
			status: "Done",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-26",
		});
		config.workflow = { enabled: true, rqPath: join(root, "missing-rq.exe") };
		await core.filesystem.saveConfig(config);
		const task = await core.filesystem.loadTask("task-1");
		if (!task) throw new Error("fixture task missing");
		await core.updateTask({ ...task, title: "Edited history" });
		const edited = await core.filesystem.loadTask("task-1");
		if (!edited) throw new Error("edited task missing");
		await core.updateTask({ ...edited, status: "To Do" });
		expect((await core.filesystem.loadTask("task-1"))?.title).toBe("Edited history");
		expect((await core.filesystem.loadTask("task-1"))?.status).toBe("To Do");
	});

	it("blocks lifecycle changes for any pending request joined by task identity", async () => {
		const root = await mkdtemp(join(tmpdir(), "backlog-workflow-pending-request-"));
		roots.push(root);
		const core = new Core(root);
		await initializeFilesystemTestProject(core, "Pending request fixture");
		await core.createTask({
			id: "task-1",
			title: "Lifecycle task",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-26",
		});
		await configureBoardFixture(core, root, {
			tasks: [{ original_id: "task-1", source_type: "backlog-task" }],
			requests: [
				{
					ticket: "task-1",
					source_type: "backlog-task",
					status: "pending",
					kind: "decision",
					question: "Any question",
				},
			],
		});
		await expect(core.archiveTask("task-1")).rejects.toThrow("unresolved workflow request");
		expect(await core.filesystem.loadTask("task-1")).not.toBeNull();
	});

	it("does not block a lifecycle change because a task title contains marker text", async () => {
		const root = await mkdtemp(join(tmpdir(), "backlog-workflow-marker-title-"));
		roots.push(root);
		const core = new Core(root);
		await initializeFilesystemTestProject(core, "Marker title fixture");
		await core.createTask({
			id: "task-1",
			title: "待我审 is part of the title",
			status: "To Do",
			assignee: [],
			labels: [],
			dependencies: [],
			createdDate: "2026-10-26",
		});
		await configureBoardFixture(core, root, {
			tasks: [{ original_id: "task-1", source_type: "backlog-task", title: "待我审 is part of the title" }],
			requests: [],
		});
		expect(await core.archiveTask("task-1")).toBe(true);
	});
});
