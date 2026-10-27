import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { BacklogServer } from "../server/index.ts";
import { initializeFilesystemTestProject } from "./test-utils.ts";

const fixtures: string[] = [];
let server: BacklogServer | undefined;

afterEach(async () => {
	await server?.stop();
	server = undefined;
	await Promise.all(fixtures.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("workflow snapshot recovery", () => {
	it("does not cache a failed board snapshot", async () => {
		const parent = await mkdtemp(join(tmpdir(), "backlog-workflow-recovery-"));
		const root = join(parent, "project");
		const marker = join(parent, "first-board-failure.marker");
		const command = join(parent, "rq-recovery.cmd");
		fixtures.push(parent);
		await mkdir(root, { recursive: true });
		const core = new Core(root);
		await initializeFilesystemTestProject(core, "Recovery");
		const config = await core.filesystem.loadConfig();
		if (!config) throw new Error("Test config was not initialized");
		await core.filesystem.saveConfig({ ...config, workflow: { enabled: true, rqPath: command } });
		core.disposeContentStore();
		core.disposeSearchService();
		await writeFile(
			command,
			`@echo off\r\nif exist "${marker}" (echo {"tasks":[],"requests":[]} & exit /b 0)\r\n>"${marker}" echo failed\r\n>&2 echo transient board failure\r\nexit /b 1\r\n`,
			"utf8",
		);
		server = new BacklogServer(root);
		await server.start(0, false);
		const base = `http://127.0.0.1:${server.getPort()}`;
		const first = await fetch(`${base}/api/workflow`);
		const firstBody = (await first.json()) as { ok?: boolean };
		expect(firstBody.ok).toBe(false);
		const second = await fetch(`${base}/api/workflow`);
		const secondBody = (await second.json()) as { ok?: boolean };
		expect(secondBody.ok).toBe(true);
	});

	it("forces one fresh board read without changing the cached read", async () => {
		const parent = await mkdtemp(join(tmpdir(), "backlog-workflow-refresh-"));
		const root = join(parent, "project");
		const marker = join(parent, "ready.marker");
		const command = join(parent, "rq-refresh.cmd");
		fixtures.push(parent);
		await mkdir(root, { recursive: true });
		const core = new Core(root);
		await initializeFilesystemTestProject(core, "Refresh");
		const config = await core.filesystem.loadConfig();
		if (!config) throw new Error("Test config was not initialized");
		await core.filesystem.saveConfig({ ...config, workflow: { enabled: true, rqPath: command } });
		core.disposeContentStore();
		core.disposeSearchService();
		await writeFile(
			command,
			`@echo off\r\nif exist "${marker}" echo {"tasks":[{"title":"new"}]} & if exist "${marker}" exit /b 0\r\necho {"tasks":[{"title":"old"}]}\r\n`,
			"utf8",
		);
		server = new BacklogServer(root);
		await server.start(0, false);
		const base = `http://127.0.0.1:${server.getPort()}`;
		const first = await fetch(`${base}/api/workflow`);
		expect((await first.json()).data.tasks[0].title).toBe("old");
		const cached = await fetch(`${base}/api/workflow`);
		expect((await cached.json()).data.tasks[0].title).toBe("old");
		await writeFile(marker, "ready", "utf8");
		const refreshed = await fetch(`${base}/api/workflow?refresh=true`);
		expect((await refreshed.json()).data.tasks[0].title).toBe("new");
	});
});
