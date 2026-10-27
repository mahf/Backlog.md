import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { initializeFilesystemTestProject } from "./test-utils.ts";

const roots: string[] = [];
const cli = join(import.meta.dir, "..", "cli.ts");
const rq = `import json, pathlib, sys
root = pathlib.Path(sys.argv[sys.argv.index("--root") + 1])
state_path = root / "rq-state.json"
state = json.loads(state_path.read_text()) if state_path.exists() else {}
if "request" in sys.argv:
    state = {"request_id": "E2E-TUI-ANSWER", "kind": "decision", "ticket": "TASK-1", "status": "pending"}
    state_path.write_text(json.dumps(state))
    print(state["request_id"])
elif "respond" in sys.argv:
    if (root / "business-failure").exists():
        print("business rule rejected", file=sys.stderr)
        sys.exit(7)
    state.update({"status": "answered", "reply": sys.argv[sys.argv.index("respond") + 2], "action": "answer", "idempotency_key": sys.argv[sys.argv.index("--idempotency-key") + 1]})
    state_path.write_text(json.dumps(state))
    print("答复已保存；投递状态：pending")
elif "board" in sys.argv:
    if (root / "board-unavailable").exists():
        print("board unavailable", file=sys.stderr)
        sys.exit(2)
    print(json.dumps({"requests": [state] if state else []}))
`;

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("workflow CLI machine response", () => {
	it("forwards request identity and verifies response facts in JSON", async () => {
		const root = await mkdtemp(join(tmpdir(), "backlog-workflow-cli-中文-"));
		roots.push(root);
		const core = new Core(root);
		await initializeFilesystemTestProject(core, "CLI workflow fixture");
		const rqPath = join(root, "rq-fixture.py");
		await writeFile(rqPath, rq, "utf8");
		const config = await core.filesystem.loadConfig();
		if (!config) throw new Error("fixture config missing");
		config.workflow = { enabled: true, rqPath, pythonPath: "python" };
		await core.filesystem.saveConfig(config);
		const run = async (...args: string[]) => {
			const processHandle = Bun.spawn(["bun", cli, "workflow", ...args, "--cwd", root, "--json"], {
				stdout: "pipe",
				stderr: "pipe",
			});
			return {
				exitCode: await processHandle.exited,
				stdout: await new Response(processHandle.stdout).text(),
				stderr: await new Response(processHandle.stderr).text(),
			};
		};
		const request = await run("request", "TASK-1", "decision", "Question", "--request-id", "E2E-TUI-ANSWER");
		expect(request.exitCode).toBe(0);
		expect(JSON.parse(request.stdout).stdout.trim()).toBe("E2E-TUI-ANSWER");
		const response = await run("respond", "E2E-TUI-ANSWER", "Keep", "--idempotency-key", "answer-1");
		expect(response.exitCode).toBe(0);
		const machine = JSON.parse(response.stdout) as { saved: boolean; projectionPending: boolean; stdout: string };
		expect(machine.saved).toBe(true);
		expect(machine.projectionPending).toBe(false);
		expect(machine.stdout).toContain("答复已保存");
	});

	it(
		"omits unverifiable facts, rejects wrong identity, and keeps idempotent replay verified",
		async () => {
			const root = await mkdtemp(join(tmpdir(), "backlog-workflow-cli-facts-"));
			roots.push(root);
			const core = new Core(root);
			await initializeFilesystemTestProject(core, "CLI facts fixture");
			const rqPath = join(root, "rq-fixture.py");
			await writeFile(rqPath, rq, "utf8");
			const config = await core.filesystem.loadConfig();
			if (!config) throw new Error("fixture config missing");
			config.workflow = { enabled: true, rqPath, pythonPath: "python" };
			await core.filesystem.saveConfig(config);
			const run = async (...args: string[]) => {
				const processHandle = Bun.spawn(["bun", cli, "workflow", ...args, "--cwd", root, "--json"], {
					stdout: "pipe",
					stderr: "pipe",
				});
				return { exitCode: await processHandle.exited, stdout: await new Response(processHandle.stdout).text() };
			};
			await run("request", "TASK-1", "decision", "Question", "--request-id", "E2E-TUI-ANSWER");
			const wrong = await run("respond", "OTHER", "Keep", "--idempotency-key", "wrong");
			expect(JSON.parse(wrong.stdout).saved).toBeUndefined();
			const first = await run("respond", "E2E-TUI-ANSWER", "Keep", "--idempotency-key", "answer-1");
			expect(JSON.parse(first.stdout).saved).toBe(true);
			const replay = await run("respond", "E2E-TUI-ANSWER", "Keep", "--idempotency-key", "answer-1");
			expect(JSON.parse(replay.stdout).saved).toBe(true);
			await writeFile(join(root, "board-unavailable"), "1", "utf8");
			const unknown = await run("respond", "E2E-TUI-ANSWER", "Keep", "--idempotency-key", "answer-1");
			expect(JSON.parse(unknown.stdout).saved).toBeUndefined();
		},
		{ timeout: 20000 },
	);

	it("preserves business failures without claiming saved", async () => {
		const root = await mkdtemp(join(tmpdir(), "backlog-workflow-cli-failure-"));
		roots.push(root);
		const core = new Core(root);
		await initializeFilesystemTestProject(core, "CLI failure fixture");
		const rqPath = join(root, "rq-fixture.py");
		await writeFile(rqPath, rq, "utf8");
		const config = await core.filesystem.loadConfig();
		if (!config) throw new Error("fixture config missing");
		config.workflow = { enabled: true, rqPath, pythonPath: "python" };
		await core.filesystem.saveConfig(config);
		await writeFile(join(root, "business-failure"), "1", "utf8");
		const processHandle = Bun.spawn(
			[
				"bun",
				cli,
				"workflow",
				"respond",
				"E2E-TUI-ANSWER",
				"Keep",
				"--idempotency-key",
				"fail",
				"--cwd",
				root,
				"--json",
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
		const output = await new Response(processHandle.stdout).text();
		expect(await processHandle.exited).toBe(7);
		expect(JSON.parse(output).saved).toBeUndefined();
	});
});
