import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const rqPath = process.env.BACKLOG_RQ_PATH?.trim();
const pythonPath = process.env.BACKLOG_RQ_PYTHON?.trim() || "python";
const cliPath = join(import.meta.dir, "..", "cli.ts");
const roots: string[] = [];

type CommandResult = { exitCode: number; stdout: string; stderr: string };

async function run(command: string[], cwd: string, timeoutMs = 20_000): Promise<CommandResult> {
	const child = Bun.spawn(command, {
		cwd,
		env: { ...process.env, BACKLOG_RQ_PATH: rqPath },
		stdout: "pipe",
		stderr: "pipe",
	});
	const output = Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]).then(
		([exitCode, stdout, stderr]) => ({ exitCode, stdout, stderr }),
	);
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			output,
			new Promise<CommandResult>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms: ${command.join(" ")}`)), timeoutMs);
			}),
		]);
	} catch (error) {
		child.kill();
		throw error;
	} finally {
		if (timer) clearTimeout(timer);
	}
}

function requireSuccess(result: CommandResult, label: string): CommandResult {
	if (result.exitCode !== 0)
		throw new Error(`${label} failed (${result.exitCode})\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
	return result;
}

async function rq(root: string, ...args: string[]): Promise<CommandResult> {
	return run([pythonPath, rqPath as string, "--root", root, ...args], root);
}

async function workflow(root: string, ...args: string[]): Promise<CommandResult> {
	return run(["bun", cliPath, "workflow", ...args, "--cwd", root, "--json"], root);
}

async function taskCommand(root: string, ...args: string[]): Promise<CommandResult> {
	return run(["bun", cliPath, "task", ...args], root);
}

async function currentReviewRevision(root: string, taskId: string): Promise<string> {
	const board = requireSuccess(await rq(root, "board", "--plain"), "rq board revision");
	const task = (
		JSON.parse(board.stdout) as { tasks?: Array<{ original_id?: string; review_revision?: string }> }
	).tasks?.find((item) => item.original_id?.toUpperCase() === taskId.toUpperCase());
	if (!task?.review_revision) throw new Error(`rq board has no review revision for ${taskId}: ${board.stdout}`);
	return task.review_revision;
}

const nativeIntegration = it.skipIf(!rqPath);

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("canonical workflow CLI with isolated real rq", () => {
	nativeIntegration(
		"records, invalidates, refreshes, and completes a task through public subprocesses",
		async () => {
			const root = await mkdtemp(join(tmpdir(), "backlog-workflow-cli-e2e-中文-"));
			roots.push(root);
			const init = await run(
				[
					"bun",
					cliPath,
					"init",
					"Canonical E2E",
					"--defaults",
					"--no-git",
					"--task-prefix",
					"T",
					"--agent-instructions",
					"none",
				],
				root,
			);
			requireSuccess(init, "init");
			// rq supports snapshot baselines for an unborn temporary Git repository; no commit is created.
			requireSuccess(await run(["git", "init"], root), "git init");
			requireSuccess(
				await workflow(root, "config", "--enabled", "true", "--rq-path", rqPath as string, "--python-path", pythonPath),
				"workflow config",
			);
			await mkdir(join(root, "workflow"), { recursive: true });
			await writeFile(join(root, "workflow", "REVIEW-POLICY.md"), "```policy\nl1_default=none\n```\n", "utf8");

			const created = await taskCommand(
				root,
				"create",
				"Canonical E2E delivery",
				"--status",
				"In Progress",
				"--description",
				"Current delivery evidence\n\n## Dispatch\n| Complexity | L1 |\n\n## Acceptance Assertions\n- [x] A1: Evidence complete\n  - 功能结果: PASS",
				"--modified-file",
				"docs/material.md",
				"--plain",
			);
			requireSuccess(created, "task create");
			const listed = requireSuccess(await taskCommand(root, "list", "--json"), "task list");
			const taskId = (JSON.parse(listed.stdout) as { tasks?: Array<{ id?: string }> }).tasks?.[0]?.id;
			if (!taskId) throw new Error(`allocator did not return a task id: ${listed.stdout}`);
			await mkdir(join(root, "docs"), { recursive: true });
			await writeFile(join(root, "docs", "material.md"), "delivery-v1\n", "utf8");

			const evidence = join(root, "backlog", "evidence", taskId);
			await mkdir(evidence, { recursive: true });
			await writeFile(
				join(evidence, "receipt.md"),
				"# Execution receipt\n\nThe isolated E2E command completed.\n",
				"utf8",
			);
			await writeFile(
				join(evidence, "review.md"),
				"# Code Review\n\n## Part A: AI review\n\n审查者: isolated-e2e\n\n| Assertion | Location | Evidence | Conclusion |\n|---|---|---|---|\n| A1 | docs/material.md | isolated command | PASS |\n\n### Findings\n\nNo findings.\n",
				"utf8",
			);
			requireSuccess(await rq(root, "changes", taskId, "--repo", ".", "--path", "docs/material.md"), "rq changes v1");
			requireSuccess(
				await rq(root, "run-check", taskId, "--assertion", "A1", "--cwd", ".", "--", pythonPath, "-c", "print(1)"),
				"rq run-check v1",
			);

			const request = requireSuccess(
				await workflow(
					root,
					"request",
					taskId,
					"decision",
					"Proceed with the reviewed delivery",
					"--request-id",
					"E2E-DECISION",
				),
				"workflow request",
			);
			const requestData = JSON.parse(request.stdout) as { stdout?: string };
			expect(requestData.stdout ?? request.stdout).toContain("E2E-DECISION");
			const response = requireSuccess(
				await workflow(
					root,
					"respond",
					"E2E-DECISION",
					"Proceed",
					"--action",
					"answer",
					"--idempotency-key",
					"e2e-answer-v1",
				),
				"workflow respond",
			);
			const responseData = JSON.parse(response.stdout) as { saved?: boolean; projectionPending?: boolean };
			expect(responseData.saved).toBe(true);
			expect(responseData.projectionPending).toBe(false);
			const replay = requireSuccess(
				await workflow(
					root,
					"respond",
					"E2E-DECISION",
					"Proceed",
					"--action",
					"answer",
					"--idempotency-key",
					"e2e-answer-v1",
				),
				"workflow respond replay",
			);
			expect((JSON.parse(replay.stdout) as { saved?: boolean }).saved).toBe(true);
			const reviewRevisionV1 = await currentReviewRevision(root, taskId);
			requireSuccess(
				await workflow(
					root,
					"review",
					taskId,
					"approve",
					"--expected-revision",
					reviewRevisionV1,
					"--note",
					"Evidence and checks verified",
				),
				"workflow review v1",
			);

			const edited = await taskCommand(
				root,
				"edit",
				taskId,
				"--description",
				"Current delivery evidence changed\n\n## Dispatch\n| Complexity | L1 |\n\n## Acceptance Assertions\n- [x] A1: Evidence complete\n  - 功能结果: PASS",
				"--modified-file",
				"docs/material.md",
			);
			requireSuccess(edited, "task material edit");
			await writeFile(join(root, "docs", "material.md"), "delivery-v2\n", "utf8");
			const staleBoard = requireSuccess(await workflow(root, "board"), "workflow board stale");
			const staleText = staleBoard.stdout.toLowerCase();
			expect(staleText).toMatch(/stale|过期|重新/);
			const staleResponse = await workflow(
				root,
				"request",
				taskId,
				"review",
				"Re-review after material change",
				"--request-id",
				"E2E-STALE",
				"--revision",
				reviewRevisionV1,
			);
			requireSuccess(staleResponse, "workflow stale request");
			const rejected = await workflow(
				root,
				"respond",
				"E2E-STALE",
				"Approve old material",
				"--action",
				"approve",
				"--expected-revision",
				reviewRevisionV1,
				"--idempotency-key",
				"e2e-stale",
			);
			expect(rejected.exitCode).not.toBe(0);
			expect(`${rejected.stdout}\n${rejected.stderr}`.toLowerCase()).toMatch(/stale|revision|过期|版本/);
			requireSuccess(
				await workflow(root, "cancel", "E2E-STALE", "--reason", "Stale revision requires refreshed evidence"),
				"cancel stale request",
			);

			requireSuccess(await rq(root, "changes", taskId, "--repo", ".", "--path", "docs/material.md"), "rq changes v2");
			requireSuccess(
				await rq(root, "run-check", taskId, "--assertion", "A1", "--cwd", ".", "--", pythonPath, "-c", "print(1)"),
				"rq run-check v2",
			);
			requireSuccess(
				await workflow(
					root,
					"review",
					taskId,
					"approve",
					"--expected-revision",
					await currentReviewRevision(root, taskId),
					"--note",
					"Re-reviewed refreshed material",
				),
				"workflow review v2",
			);
			const done = await taskCommand(root, "edit", taskId, "--status", "Done");
			requireSuccess(done, "task Done through canonical CLI");
			const final = requireSuccess(await taskCommand(root, "view", taskId, "--json"), "task final view");
			const finalData = JSON.parse(final.stdout) as {
				status?: string;
				task?: { status?: string };
				data?: { status?: string; task?: { status?: string } };
			};
			expect(finalData.status ?? finalData.task?.status ?? finalData.data?.status ?? finalData.data?.task?.status).toBe(
				"Done",
			);
		},
		120_000,
	);
});
