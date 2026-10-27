import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { $ } from "bun";
import { assertWorkspaceWritable, resolveWorkspaceRoot } from "../core/workspace-context.ts";
import { listWorkspaces, registerWorkspace, removeWorkspace, updateWorkspace } from "../core/workspace-registry.ts";
import { getTestCliPath } from "./test-cli.ts";
import { initializeFilesystemTestProject } from "./test-utils.ts";

const CLI_PATH = getTestCliPath();

let root: string;
let registry: string;

async function project(name: string): Promise<string> {
	const path = join(root, name);
	await mkdir(join(path, "backlog"), { recursive: true });
	await writeFile(join(path, "backlog", "config.yml"), "project_name: Fixture\n");
	return path;
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "backlog-workspace-中文 "));
	registry = join(root, "registry.json");
	process.env.BACKLOG_WORKSPACES_FILE = registry;
});

afterEach(async () => {
	delete process.env.BACKLOG_WORKSPACES_FILE;
	await rm(root, { recursive: true, force: true });
});

describe("workspace registry", () => {
	it("persists a no-Git project and canonicalizes aliases", async () => {
		const path = await project("Project With Space");
		const configBefore = await readFile(join(path, "backlog", "config.yml"), "utf8");
		const entry = await registerWorkspace({
			id: "fixture",
			name: "中文 project",
			rootPath: join(path, "."),
			writable: true,
		});
		expect(entry.rootPath).toBe(path);
		expect((await listWorkspaces()).map(({ id }) => id)).toEqual(["fixture"]);
		await updateWorkspace("fixture", { writable: false });
		expect((await listWorkspaces())[0]?.writable).toBe(false);
		await removeWorkspace("fixture");
		expect(await readFile(join(path, "backlog", "config.yml"), "utf8")).toBe(configBefore);
	});

	it("rejects duplicate ids, roots, aliases, blank names, and string booleans", async () => {
		const path = await project("project");
		const booleanPath = await project("boolean");
		await registerWorkspace({ id: "fixture", name: "Fixture", rootPath: path, writable: false });
		await expect(
			registerWorkspace({ id: "other", name: "Other", rootPath: join(path, "..", "project"), writable: false }),
		).rejects.toThrow("root already exists");
		await expect(registerWorkspace({ id: "fixture", name: "Other", rootPath: path, writable: false })).rejects.toThrow(
			"id already exists",
		);
		await expect(
			registerWorkspace({ id: "other", name: " ", rootPath: join(root, "missing"), writable: false }),
		).rejects.toThrow("inaccessible");
		await expect(
			registerWorkspace({ id: "bad", name: "Bad", rootPath: booleanPath, writable: "false" as never }),
		).rejects.toThrow("strict boolean");
		await expect(updateWorkspace("fixture", { name: " " })).rejects.toThrow("must not be blank");
	});

	it("reports missing and uninitialized roots without blocking healthy entries", async () => {
		const healthy = await project("healthy");
		const missing = join(root, "missing");
		await writeFile(
			registry,
			JSON.stringify({
				version: 1,
				workspaces: [
					{ id: "healthy", name: "Healthy", rootPath: healthy, writable: false },
					{ id: "missing", name: "Missing", rootPath: missing, writable: false },
					{ id: "plain", name: "Plain", rootPath: root, writable: false },
				],
			}),
		);
		const entries = await listWorkspaces();
		expect(entries.find(({ id }) => id === "healthy")?.error).toBeUndefined();
		expect(entries.find(({ id }) => id === "missing")?.error).toContain("inaccessible");
		expect(entries.find(({ id }) => id === "plain")?.error).toContain("not an initialized");
		await removeWorkspace("missing");
		expect((await listWorkspaces()).map(({ id }) => id)).toEqual(["healthy", "plain"]);
	});

	it("rejects malformed persisted schema before mutation", async () => {
		await writeFile(registry, JSON.stringify({ version: 2, workspaces: [] }));
		await expect(listWorkspaces()).rejects.toThrow("version 1");
		await writeFile(
			registry,
			JSON.stringify({ version: 1, workspaces: [{ id: "x", name: "X", rootPath: "relative", writable: false }] }),
		);
		await expect(listWorkspaces()).rejects.toThrow("absolute");
		await writeFile(
			registry,
			JSON.stringify({
				version: 1,
				workspaces: [{ id: "x", name: "X", rootPath: join(root, "x"), writable: "false" }],
			}),
		);
		await expect(listWorkspaces()).rejects.toThrow("boolean");
		await writeFile(
			registry,
			JSON.stringify({
				version: 1,
				workspaces: [
					{ id: "duplicate", name: "One", rootPath: join(root, "one"), writable: false },
					{ id: "duplicate", name: "Two", rootPath: join(root, "two"), writable: false },
				],
			}),
		);
		await expect(listWorkspaces()).rejects.toThrow("duplicate id");
		await writeFile(
			registry,
			JSON.stringify({
				version: 1,
				workspaces: [
					{ id: "one", name: "One", rootPath: join(root, "same"), writable: false },
					{ id: "two", name: "Two", rootPath: join(root, ".", "same"), writable: false },
				],
			}),
		);
		await expect(listWorkspaces()).rejects.toThrow("duplicate rootPath");
	});

	it("preserves filesystem roots while rejecting ancestor backlog discovery", async () => {
		const ancestor = join(root, "ancestor");
		await mkdir(join(ancestor, "backlog"), { recursive: true });
		await writeFile(join(ancestor, "backlog", "config.yml"), "project_name: Ancestor\n");
		const child = join(ancestor, "child");
		await mkdir(child, { recursive: true });
		await writeFile(
			registry,
			JSON.stringify({ version: 1, workspaces: [{ id: "child", name: "Child", rootPath: child, writable: false }] }),
		);
		expect((await listWorkspaces())[0]?.error).toContain("not an initialized");
	});

	it("preserves a Windows filesystem root as an absolute normalized path", async () => {
		const filesystemRoot = parse(process.cwd()).root;
		await writeFile(
			registry,
			JSON.stringify({
				version: 1,
				workspaces: [{ id: "root", name: "Root", rootPath: filesystemRoot, writable: false }],
			}),
		);
		expect((await listWorkspaces())[0]?.rootPath).toBe(filesystemRoot);
	});

	it("serializes concurrent registrations without lost updates", async () => {
		const paths = await Promise.all([project("one"), project("two"), project("three")]);
		await Promise.all(
			paths.map((path, index) =>
				registerWorkspace({ id: `workspace-${index}`, name: `Workspace ${index}`, rootPath: path }),
			),
		);
		expect((await listWorkspaces()).map(({ id }) => id)).toEqual(["workspace-0", "workspace-1", "workspace-2"]);
	});

	it("registers two Git roots and one filesystem-only root", async () => {
		const gitOne = await project("git-one");
		const gitTwo = await project("git-two");
		const filesystemOnly = await project("filesystem-only");
		await $`git init --quiet`.cwd(gitOne).quiet();
		await $`git init --quiet`.cwd(gitTwo).quiet();
		await registerWorkspace({ id: "git-one", rootPath: gitOne });
		await registerWorkspace({ id: "git-two", rootPath: gitTwo });
		await registerWorkspace({ id: "filesystem-only", rootPath: filesystemOnly });
		expect((await listWorkspaces()).every(({ error }) => error === undefined)).toBe(true);
	});

	it("treats a junction alias as the same root when supported", async () => {
		const path = await project("junction-target");
		const alias = join(root, "junction alias");
		try {
			await symlink(path, alias, "junction");
		} catch {
			console.warn("SKIP workspace junction alias test: junction creation is unavailable");
			return;
		}
		await registerWorkspace({ id: "target", name: "Target", rootPath: path });
		await expect(registerWorkspace({ id: "alias", name: "Alias", rootPath: alias })).rejects.toThrow(
			"root already exists",
		);
	});

	it("resolves an explicit workspace and fails closed for missing or read-only targets", async () => {
		const path = await project("selected");
		await registerWorkspace({ id: "selected", rootPath: path, writable: false });
		expect((await resolveWorkspaceRoot({ workspace: "selected" }, root)).rootPath).toBe(path);
		expect(resolveWorkspaceRoot({ workspace: "missing" }, root)).rejects.toThrow("Workspace not found");
		expect(() =>
			assertWorkspaceWritable({ id: "selected", name: "Selected", rootPath: path, writable: false }, "task edit"),
		).toThrow("read-only");
		expect(() =>
			assertWorkspaceWritable({ id: "selected", name: "Selected", rootPath: path, writable: true }, "task edit"),
		).not.toThrow();
	});

	it("inherits a registered workspace permission for implicit cwd discovery", async () => {
		const path = await project("implicit");
		await registerWorkspace({ id: "implicit", rootPath: path, writable: false });
		const resolved = await resolveWorkspaceRoot({}, join(path, "backlog"));
		expect(resolved.rootPath).toBe(path);
		expect(resolved.workspace?.id).toBe("implicit");
		expect(resolved.workspace?.writable).toBe(false);
	});

	it("rejects a write even when a task title looks like a read-only action", async () => {
		const path = join(root, "readonly-cli");
		const { Core } = await import("../core/backlog.ts");
		const fixture = new Core(path);
		await initializeFilesystemTestProject(fixture, "Read-only CLI");
		fixture.disposeContentStore();
		fixture.disposeSearchService();
		await registerWorkspace({ id: "readonly", rootPath: path, writable: false });
		const result = await $`bun ${CLI_PATH} task --workspace readonly create view`.cwd(root).quiet().nothrow();
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain("read-only");
	});

	it("allows explicit public reads while blocking config and document writes", async () => {
		const path = join(root, "readonly-reads");
		const { Core } = await import("../core/backlog.ts");
		const fixture = new Core(path);
		await initializeFilesystemTestProject(fixture, "Read-only reads");
		fixture.disposeContentStore();
		fixture.disposeSearchService();
		await registerWorkspace({ id: "readonly-reads", rootPath: path, writable: false });
		const configList = await $`bun ${CLI_PATH} --workspace readonly-reads config list`.cwd(root).quiet().nothrow();
		expect(configList.exitCode).toBe(0);
		expect(configList.stdout.toString()).toContain("projectName");
		const configGet = await $`bun ${CLI_PATH} --workspace readonly-reads config get projectName`
			.cwd(root)
			.quiet()
			.nothrow();
		expect(configGet.exitCode).toBe(0);
		expect(configGet.stdout.toString()).toContain("Read-only reads");
		const docList = await $`bun ${CLI_PATH} --workspace readonly-reads doc list --plain`.cwd(root).quiet().nothrow();
		expect(docList.exitCode).toBe(0);
		const decisionList = await $`bun ${CLI_PATH} --workspace readonly-reads decision list --plain`
			.cwd(root)
			.quiet()
			.nothrow();
		expect(decisionList.exitCode).toBe(0);
		const configWrite = await $`bun ${CLI_PATH} --workspace readonly-reads config set projectName changed`
			.cwd(root)
			.quiet()
			.nothrow();
		expect(configWrite.exitCode).not.toBe(0);
		expect(configWrite.stderr.toString()).toContain("read-only");
		const adversarialTitle = await $`bun ${CLI_PATH} --workspace readonly-reads doc create view`
			.cwd(root)
			.quiet()
			.nothrow();
		expect(adversarialTitle.exitCode).not.toBe(0);
		expect(adversarialTitle.stderr.toString()).toContain("read-only");
	});

	it("queries two projects with the same task ID and emits workspace identity", async () => {
		const projects = [join(root, "one"), join(root, "two")];
		for (const [index, path] of projects.entries()) {
			const { Core } = await import("../core/backlog.ts");
			const fixture = new Core(path);
			await initializeFilesystemTestProject(fixture, `Project ${index}`);
			fixture.disposeContentStore();
			fixture.disposeSearchService();
			await $`bun ${CLI_PATH} task create ${`Same task ${index}`}`.cwd(path).quiet();
			await registerWorkspace({ id: `project-${index}`, rootPath: path, writable: false });
		}
		const result = await $`bun ${CLI_PATH} --all-workspaces task list --json`.cwd(root).quiet();
		const output = JSON.parse(result.stdout.toString()) as {
			tasks: Array<{ id: string; workspaceId: string }>;
			errors: unknown[];
		};
		expect(output.tasks).toHaveLength(2);
		expect(new Set(output.tasks.map((task) => task.id))).toEqual(new Set(["TASK-1"]));
		expect(new Set(output.tasks.map((task) => task.workspaceId))).toEqual(new Set(["project-0", "project-1"]));
		expect(output.errors).toHaveLength(0);
	});
});
