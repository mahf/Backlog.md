import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	runWorkflow,
	type WorkflowCommandResult,
	workflowAvailability,
	workflowSnapshot,
} from "../core/workflow-adapter.ts";

const result = (stdout = "", stderr = "", exitCode = 0): WorkflowCommandResult => ({ stdout, stderr, exitCode });
const rqPath = process.env.BACKLOG_RQ_PATH?.trim();
const integration = it.skipIf(!rqPath);
const configuredRqPath = (): string =>
	rqPath ||
	(() => {
		throw new Error("BACKLOG_RQ_PATH is required");
	})();
const fixtures: string[] = [];

async function reviewFixture(name: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), `backlog-workflow-${name}-中文-`));
	fixtures.push(root);
	await mkdir(join(root, "backlog", "tickets"), { recursive: true });
	await mkdir(join(root, "backlog", "evidence", "T-001"), { recursive: true });
	await mkdir(join(root, "docs"), { recursive: true });
	await writeFile(join(root, "backlog", "config.yml"), 'project_name: "Fixture"\n');
	await writeFile(join(root, "docs", "a.md"), "original\n");
	await writeFile(
		join(root, "backlog", "tickets", "T-001-test.md"),
		"# T-001 test\nstatus: in-review\n\n## Touches\n- docs/a.md\n\n## Acceptance Assertions\n- [x] A1: document changes\n  - 结果: PASS\n",
	);
	await writeFile(join(root, "backlog", "evidence", "T-001", "receipt.md"), "completed\n");
	await writeFile(
		join(root, "backlog", "evidence", "T-001", "review.md"),
		"## Part A\n审查者：terra\n| 断言 | 实现位置 | 证据 | 结论 |\n| A1 | docs/a.md:1 | checks.json | PASS |\n",
	);
	return root;
}

async function ledger(root: string): Promise<Array<Record<string, string>>> {
	const path = join(root, "backlog", "decisions", "approvals.jsonl");
	try {
		return (await readFile(path, "utf8"))
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as Record<string, string>);
	} catch {
		return [];
	}
}

afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("workflow adapter", () => {
	it("passes the project root to the public rq command", async () => {
		let argv: string[] = [];
		const response = await runWorkflow(["card", "T-1"], {
			root: "C:\\fixture",
			rq: "rq.cmd",
			runner: async (next) => {
				argv = next;
				return result("card");
			},
		});
		expect(argv).toEqual(["rq.cmd", "--root", "C:\\fixture", "card", "T-1"]);
		expect(response.stdout).toBe("card");
	});

	it("fails closed when disabled or unavailable", async () => {
		expect((await runWorkflow(["inbox"], { root: "fixture", enabled: false })).exitCode).toBe(2);
		const unavailable = await workflowAvailability({
			root: "fixture",
			runner: async () => result("", "rq is missing", 127),
		});
		expect(unavailable).toEqual({ enabled: true, available: false, message: "rq is missing" });
	});

	it("uses the board plain snapshot for readiness and preserves errors", async () => {
		let argv: string[] = [];
		const snapshot = await workflowSnapshot({
			root: "fixture",
			rq: "rq",
			runner: async (next) => {
				argv = next;
				return result('{"requests":[]}');
			},
		});
		expect(argv).toEqual(["rq", "--root", "fixture", "board", "--plain"]);
		expect(snapshot.stdout).toContain("requests");
	});

	it("limits concurrent read-only board processes without limiting mutations", async () => {
		let active = 0;
		let peak = 0;
		const runner = async (argv: string[]) => {
			if (argv.includes("board")) {
				active++;
				peak = Math.max(peak, active);
				await new Promise((resolve) => setTimeout(resolve, 10));
				active--;
			}
			return result("{}");
		};
		await Promise.all(
			Array.from({ length: 9 }, (_, index) => runWorkflow(["board", "--plain"], { root: `fixture-${index}`, runner })),
		);
		expect(peak).toBe(4);
	});

	it("kills a hanging board process and lets the next query recover", async () => {
		const root = await mkdtemp(join(tmpdir(), "backlog-workflow-timeout-"));
		fixtures.push(root);
		const marker = join(root, "outside-watch.marker");
		const command = join(root, "hanging-rq.cmd");
		await writeFile(
			command,
			`@echo off\r\nif exist "${marker}" (echo {"tasks":[]} & exit /b 0)\r\n>"${marker}" echo started\r\nping -n 20 127.0.0.1 >nul\r\n`,
			"utf8",
		);
		const previousTimeout = process.env.BACKLOG_WORKFLOW_READ_TIMEOUT_MS;
		process.env.BACKLOG_WORKFLOW_READ_TIMEOUT_MS = "5000";
		try {
			const started = performance.now();
			const first = await workflowSnapshot({ root, rq: command, enabled: true });
			expect(first.exitCode).toBe(124);
			expect(performance.now() - started).toBeLessThan(10_000);
			const second = await workflowSnapshot({ root, rq: command, enabled: true });
			expect(second.exitCode).toBe(0);
		} finally {
			if (previousTimeout === undefined) delete process.env.BACKLOG_WORKFLOW_READ_TIMEOUT_MS;
			else process.env.BACKLOG_WORKFLOW_READ_TIMEOUT_MS = previousTimeout;
		}
	});

	integration("uses the real rq ledger for an isolated request and idempotent replay", async () => {
		const root = await mkdtemp(join(tmpdir(), "backlog-workflow-rq-中文-"));
		fixtures.push(root);
		await mkdir(join(root, "backlog", "specs"), { recursive: true });
		await mkdir(join(root, "backlog", "tickets"), { recursive: true });
		await writeFile(join(root, "backlog", "config.yml"), 'project_name: "Fixture"\n');
		await writeFile(join(root, "backlog", "specs", "question.md"), "# Spec\n");
		const options = { root, rq: configuredRqPath(), enabled: true };
		const first = await runWorkflow(
			["request", "-", "decision", "Choose a retention policy", "--subject-key", "backlog/specs/question.md"],
			options,
		);
		expect(first.exitCode).toBe(0);
		const requestId = first.stdout.trim();
		expect(requestId).toMatch(/^SPEC-/);
		const replay = await runWorkflow(
			["request", "-", "decision", "Choose a retention policy", "--subject-key", "backlog/specs/question.md"],
			options,
		);
		expect(replay.exitCode).toBe(0);
		expect(replay.stdout.trim()).toBe(requestId);
		const response = await runWorkflow(
			["respond", requestId, "Keep for 7 days", "--idempotency-key", "fixture-answer"],
			options,
		);
		expect(response.exitCode).toBe(0);
		expect(response.stdout).toContain("答复已保存");
		const duplicateResponse = await runWorkflow(
			["respond", requestId, "Keep for 7 days", "--idempotency-key", "fixture-answer"],
			options,
		);
		expect(duplicateResponse.exitCode).toBe(0);
		expect(duplicateResponse.stdout).toContain("幂等");
	});

	integration("approves a real review, then exposes a stale approval after an artifact change", async () => {
		const root = await reviewFixture("review");
		const options = { root, rq: configuredRqPath(), enabled: true };
		const changes = await runWorkflow(["changes", "T-001", "--path", "docs/a.md"], options);
		expect(changes.exitCode).toBe(0);
		const check = await runWorkflow(
			["run-check", "T-001", "--assertion", "A1", "--cwd", ".", "--", "python", "-c", "print('ok')"],
			options,
		);
		expect(check.exitCode).toBe(0);
		const request = await runWorkflow(["request", "T-001", "review", "Approve current evidence"], options);
		expect(request.exitCode).toBe(0);
		const requestId = request.stdout.trim();
		const revision = (await ledger(root)).find((event) => event.request_id === requestId)?.revision;
		expect(revision).toBeTruthy();
		const response = await runWorkflow(
			[
				"respond",
				requestId,
				"reviewed",
				"--action",
				"approve",
				"--expected-revision",
				revision ?? "",
				"--idempotency-key",
				"review-1",
			],
			options,
		);
		expect(response.exitCode).toBe(0);
		const before = await workflowSnapshot(options);
		expect(before.exitCode).toBe(0);
		expect(before.stdout).toContain("approve");
		await writeFile(join(root, "docs", "a.md"), "changed\n");
		const after = await workflowSnapshot(options);
		expect(after.exitCode).toBe(0);
		expect(after.stdout).toMatch(/stale|过期/);
	});

	integration("rejects an approval answered with an old revision without appending a response", async () => {
		const root = await reviewFixture("stale-revision");
		const options = { root, rq: configuredRqPath(), enabled: true };
		const request = await runWorkflow(
			["request", "T-001", "review", "Approve old evidence", "--revision", "old-revision"],
			options,
		);
		const requestId = request.stdout.trim();
		const before = await ledger(root);
		const response = await runWorkflow(
			[
				"respond",
				requestId,
				"reviewed",
				"--action",
				"approve",
				"--expected-revision",
				"old-revision",
				"--idempotency-key",
				"old-1",
			],
			options,
		);
		expect(response.exitCode).not.toBe(0);
		expect(await ledger(root)).toEqual(before);
	});

	integration("rejects ambiguous ticket/task identity and keeps two project ledgers isolated", async () => {
		const one = await reviewFixture("project-one");
		const two = await reviewFixture("project-two");
		const firstOptions = { root: one, rq: configuredRqPath(), enabled: true };
		const secondOptions = { root: two, rq: configuredRqPath(), enabled: true };
		await mkdir(join(one, "backlog", "tasks"), { recursive: true });
		await writeFile(
			join(one, "backlog", "tasks", "duplicate.md"),
			"---\nid: T-001\nstatus: In Progress\n---\n# duplicate\n",
		);
		const ambiguous = await runWorkflow(["request", "T-001", "decision", "ambiguous"], firstOptions);
		expect(ambiguous.exitCode).not.toBe(0);
		await rm(join(one, "backlog", "tasks", "duplicate.md"));
		const first = await runWorkflow(["request", "T-001", "review", "one"], firstOptions);
		const second = await runWorkflow(["request", "T-001", "review", "two"], secondOptions);
		expect(first.exitCode).toBe(0);
		expect(second.exitCode).toBe(0);
		expect((await ledger(one)).map((event) => event.request_id)).not.toEqual(
			(await ledger(two)).map((event) => event.request_id),
		);
		const unavailable = await runWorkflow(["board", "--plain"], { ...firstOptions, rq: join(one, "missing-rq.exe") });
		expect(unavailable.exitCode).toBe(127);
	});

	integration("records a response when its ticket projection is pending repair", async () => {
		const root = await mkdtemp(join(tmpdir(), "backlog-workflow-projection-pending-中文-"));
		fixtures.push(root);
		await mkdir(join(root, "backlog", "tickets"), { recursive: true });
		await writeFile(join(root, "backlog", "config.yml"), 'project_name: "Fixture"\n');
		const ticketPath = join(root, "backlog", "tickets", "T-001-decision.md");
		await writeFile(
			ticketPath,
			"# T-001 decision\nstatus: in-progress\n\n## 待决定\n| 编号 | 问题 | 建议 | 答案 |\n| 1 | Keep? | yes | |\n",
		);
		const options = { root, rq: configuredRqPath(), enabled: true };
		const request = await runWorkflow(["request", "T-001", "decision", "Choose", "--decision-id", "1"], options);
		expect(request.exitCode).toBe(0);
		const requestId = request.stdout.trim();
		await writeFile(ticketPath, "# T-001 decision\nstatus: in-progress\n");
		const response = await runWorkflow(
			["respond", requestId, "Keep", "--idempotency-key", "projection-pending-1"],
			options,
		);
		expect(response.exitCode).toBe(0);
		expect(response.stdout).toContain("投影待修复");
		expect((await ledger(root)).some((event) => event.event === "response" && event.request_id === requestId)).toBe(
			true,
		);
	});
});
