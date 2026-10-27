import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { runWorkflow, type WorkflowCommandResult } from "../src/core/workflow-adapter.ts";
import { registerWorkspace, removeWorkspace } from "../src/core/workspace-registry.ts";
import { BacklogServer } from "../src/server/index.ts";
import { WorkspaceQueryCache } from "../src/server/workspace-query-cache.ts";

const rootCounts = (process.env.BACKLOG_BENCH_ROOTS ?? "1,10,30")
	.split(",")
	.map((value) => Number(value))
	.filter((value) => Number.isInteger(value) && value > 0);
const repeats = Math.max(1, Number(process.env.BACKLOG_BENCH_REPEATS ?? "5"));
const rq = process.env.BACKLOG_RQ_PATH?.trim();
const configuredFetchTimeoutMs = Number(process.env.BACKLOG_BENCH_FETCH_TIMEOUT_MS || "10_000");
const fetchTimeoutMs = Number.isFinite(configuredFetchTimeoutMs) ? Math.max(5_000, configuredFetchTimeoutMs) : 10_000;
const configuredWarmupTimeoutMs = Number(process.env.BACKLOG_BENCH_WARMUP_TIMEOUT_MS || "180000");
const warmupTimeoutMs = Number.isFinite(configuredWarmupTimeoutMs)
	? Math.max(60_000, configuredWarmupTimeoutMs)
	: 180_000;
const artifactPath = process.env.BACKLOG_BENCH_ARTIFACT ?? "docs/validation-workspace-benchmark.json";
const fixtureParent = process.env.BACKLOG_BENCH_PARENT?.trim() || tmpdir();
let rqCalls = 0;
const invoke = (args: string[], options: Parameters<typeof runWorkflow>[1]) => {
	rqCalls++;
	return runWorkflow(args, options);
};
const samples = (values: number[]) => {
	const sorted = values.slice().sort((a, b) => a - b);
	return {
		medianMs: sorted[Math.floor(sorted.length / 2)] ?? null,
		p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? null,
	};
};

async function aggregate(
	base: string,
): Promise<{ tasks?: Array<Record<string, unknown>>; errors?: Array<Record<string, unknown>> }> {
	const response = await fetch(`${base}/api/workflow?allWorkspaces=true`, {
		signal: AbortSignal.timeout(fetchTimeoutMs),
	});
	if (!response.ok) throw new Error(`Aggregate workflow failed with status ${response.status}.`);
	return (await response.json()) as { tasks?: Array<Record<string, unknown>>; errors?: Array<Record<string, unknown>> };
}

function complete(
	snapshot: { tasks?: Array<Record<string, unknown>>; errors?: Array<Record<string, unknown>> },
	expectedTasks: number,
) {
	return snapshot.tasks?.length === expectedTasks && (!snapshot.errors || snapshot.errors.length === 0);
}

async function waitForComplete(base: string, expectedTasks: number, deadline: number, label: string) {
	let snapshot = await aggregate(base);
	while (!complete(snapshot, expectedTasks) && performance.now() < deadline) {
		console.error(
			`[benchmark] ${label}: ${snapshot.tasks?.length ?? 0}/${expectedTasks} tasks, ${snapshot.errors?.length ?? 0} errors`,
		);
		await new Promise((resolve) => setTimeout(resolve, 100));
		snapshot = await aggregate(base);
	}
	if (!complete(snapshot, expectedTasks))
		throw new Error(
			`${label} did not become complete before deadline (${snapshot.tasks?.length ?? 0}/${expectedTasks} tasks; errors=${JSON.stringify(snapshot.errors ?? [])}).`,
		);
	return snapshot;
}

async function fixture(parent: string, index: number): Promise<string> {
	if (index % 5 === 0) console.error(`[benchmark] fixture ${index}`);
	const project = join(parent, `project-${index}`);
	await mkdir(join(project, "backlog", "tasks"), { recursive: true });
	await mkdir(join(project, "backlog", "specs"), { recursive: true });
	await writeFile(
		join(project, "backlog", "config.yml"),
		`project_name: "Benchmark"\nworkflow_enabled: true\nworkflow_rq_path: ${JSON.stringify(rq ?? "")}\n`,
		"utf8",
	);
	await writeFile(join(project, "backlog", "specs", "question.md"), "# Benchmark material\n", "utf8");
	for (let task = 1; task <= 100; task++) {
		await writeFile(
			join(project, "backlog", "tasks", `task-${task}.md`),
			`---\nid: TASK-${task}\ntitle: Benchmark task ${task}\nstatus: To Do\n---\n`,
			"utf8",
		);
	}
	return project;
}

async function allBoards(
	projects: string[],
	caches: Map<string, WorkspaceQueryCache<WorkflowCommandResult>>,
	title?: string,
	titleRoot?: string,
): Promise<WorkflowCommandResult[]> {
	const results: WorkflowCommandResult[] = [];
	let next = 0;
	const worker = async () => {
		while (next < projects.length) {
			const root = projects[next++];
			if (!root) return;
			const cache = caches.get(root) ?? new WorkspaceQueryCache<WorkflowCommandResult>({ ttlMs: 60_000, watch: false });
			caches.set(root, cache);
			const result = await cache.get(root, () => invoke(["board", "--plain"], { root, enabled: true, rq }));
			if (result.exitCode !== 0) throw new Error(`rq board failed for ${root}: ${result.stderr || result.stdout}`);
			const data = JSON.parse(result.stdout) as { tasks?: Array<Record<string, unknown>> };
			if (!Array.isArray(data.tasks) || data.tasks.length !== 100)
				throw new Error(`Expected 100 tasks for ${root}, got ${data.tasks?.length ?? "invalid JSON"}`);
			if (title && root === titleRoot && data.tasks.find((task) => task.original_id === "TASK-1")?.title !== title)
				throw new Error(`Expected TASK-1 title ${title} for ${root}.`);
			results.push(result);
		}
	};
	await Promise.all(Array.from({ length: Math.min(4, Math.max(1, projects.length)) }, worker));
	return results;
}

async function rqRequest(root: string, index: number, subjectKey: string): Promise<string> {
	const result = await invoke(
		["request", "-", "decision", "Benchmark decision", "--subject-key", subjectKey, "--request-id", `BENCH-${index}`],
		{ root, enabled: true, rq },
	);
	if (result.exitCode !== 0) throw new Error(`rq request failed: ${result.stderr || result.stdout}`);
	const board = await invoke(["board", "--plain"], { root, enabled: true, rq });
	if (board.exitCode !== 0) throw new Error(`rq board after request failed: ${board.stderr || board.stdout}`);
	const data = JSON.parse(board.stdout) as { requests?: Array<Record<string, unknown>> };
	const request = data.requests?.find((item) => item.request_id === `BENCH-${index}`);
	if (typeof request?.request_id !== "string") throw new Error(`rq request BENCH-${index} was missing from board.`);
	return request.request_id;
}

async function measure(
	projects: string[],
	persist?: (result: Record<string, unknown>) => Promise<void>,
): Promise<Record<string, unknown>> {
	if (!rq) return { status: "unavailable", reason: "Set BACKLOG_RQ_PATH to an rq executable or script." };
	const caches = new Map<string, WorkspaceQueryCache<WorkflowCommandResult>>();
	const cold: number[] = [];
	const warm: number[] = [];
	const changed: number[] = [];
	const material: number[] = [];
	const respond: number[] = [];
	const productionAggregateWarm: number[] = [];
	const productionNaturalVisible: number[] = [];
	const coldRqCalls: number[] = [];
	const warmRqCalls: number[] = [];
	const changedRqCalls: number[] = [];
	rqCalls = 0;
	let totalRqCalls = 0;
	const changedRoot = projects[0];
	if (!changedRoot) throw new Error("Benchmark fixture did not create a project");
	const previousRegistryPath = process.env.BACKLOG_WORKSPACES_FILE;
	process.env.BACKLOG_WORKSPACES_FILE = join(changedRoot, "workspace-registry.json");
	const workspaceIds = projects.map((_, index) => `benchmark-${index}`);
	for (let index = 0; index < projects.length; index++)
		await registerWorkspace({ id: workspaceIds[index] as string, rootPath: projects[index] as string, writable: true });
	console.error(`[benchmark] registered ${projects.length} workspaces; starting HTTP server`);
	const httpServer = new BacklogServer(changedRoot);
	const log = console.log;
	console.log = () => undefined;
	try {
		await httpServer.start(0, false);
	} finally {
		console.log = log;
	}
	const base = `http://127.0.0.1:${httpServer.getPort()}`;
	console.error(`[benchmark] HTTP server ready on ${base}`);
	try {
		for (let i = 0; i < repeats; i++) {
			console.error(`[benchmark] roots=${projects.length} repeat=${i + 1}/${repeats} starting`);
			const cache = (httpServer as unknown as { workflowSnapshotCache: { clear: () => void } }).workflowSnapshotCache;
			cache.clear();
			await waitForComplete(base, projects.length * 100, performance.now() + warmupTimeoutMs, "warm-up");
			let started = performance.now();
			const warmSnapshot = await aggregate(base);
			if (!complete(warmSnapshot, projects.length * 100))
				throw new Error("Warm measurement started with an incomplete aggregate.");
			productionAggregateWarm.push(performance.now() - started);
			await writeFile(
				join(changedRoot, "backlog", "tasks", "task-1.md"),
				`---\nid: TASK-1\ntitle: Natural benchmark task ${i}\nstatus: To Do\n---\n`,
				"utf8",
			);
			started = performance.now();
			let natural = await aggregate(base);
			const naturalDeadline = performance.now() + 60_000;
			while (
				natural.tasks?.find((task) => task.workspaceId === workspaceIds[0] && task.original_id === "TASK-1")?.title !==
					`Natural benchmark task ${i}` &&
				performance.now() < naturalDeadline
			) {
				await new Promise((resolve) => setTimeout(resolve, 100));
				natural = await aggregate(base);
			}
			if (
				natural.tasks?.find((task) => task.workspaceId === workspaceIds[0] && task.original_id === "TASK-1")?.title !==
				`Natural benchmark task ${i}`
			)
				throw new Error(`Natural watcher change was not visible for ${projects.length} roots.`);
			productionNaturalVisible.push(performance.now() - started);
			console.error(
				`[benchmark] roots=${projects.length} repeat=${i + 1}/${repeats} natural=${productionNaturalVisible.at(-1)?.toFixed(1)}ms`,
			);
			for (const cache of caches.values()) cache.clear();
			started = performance.now();
			await allBoards(projects, caches);
			cold.push(performance.now() - started);
			coldRqCalls.push(rqCalls);
			if (rqCalls !== projects.length) throw new Error(`Expected ${projects.length} cold rq calls, got ${rqCalls}.`);
			totalRqCalls += rqCalls;
			rqCalls = 0;
			started = performance.now();
			await allBoards(projects, caches);
			warm.push(performance.now() - started);
			warmRqCalls.push(rqCalls);
			if (rqCalls !== 0) throw new Error(`Expected 0 warm rq calls, got ${rqCalls}.`);
			totalRqCalls += rqCalls;
			rqCalls = 0;
			await writeFile(
				join(changedRoot, "backlog", "tasks", "task-1.md"),
				`---\nid: TASK-1\ntitle: Changed benchmark task ${i}\nstatus: To Do\n---\n`,
				"utf8",
			);
			caches.get(changedRoot)?.refresh(changedRoot);
			started = performance.now();
			await allBoards(projects, caches, `Changed benchmark task ${i}`, changedRoot);
			changed.push(performance.now() - started);
			changedRqCalls.push(rqCalls);
			if (rqCalls !== 1) throw new Error(`Expected 1 changed-root rq call, got ${rqCalls}.`);
			totalRqCalls += rqCalls;
			rqCalls = 0;
			const subjectKey = `backlog/specs/question-${i}.md`;
			await writeFile(join(changedRoot, subjectKey), `# Benchmark material ${i}\n`, "utf8");
			const requestId = await rqRequest(changedRoot, i, subjectKey);
			{
				started = performance.now();
				const materialResponse = await fetch(
					`${base}/api/workflow/material?workspace=${workspaceIds[0]}&path=${encodeURIComponent(subjectKey)}`,
				);
				if (!materialResponse.ok) throw new Error(`HTTP material failed with status ${materialResponse.status}.`);
				const materialBody = (await materialResponse.json()) as { content?: string };
				if (!materialBody.content?.includes(`Benchmark material ${i}`))
					throw new Error("HTTP material content was incomplete.");
				material.push(performance.now() - started);
				started = performance.now();
				const response = await fetch(`${base}/api/workflow/respond?workspace=${workspaceIds[0]}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						requestId,
						reply: "Benchmark answer",
						action: "answer",
						idempotencyKey: `bench-${i}`,
					}),
				});
				const responseBody = (await response.json()) as { saved?: boolean };
				if (!response.ok || !responseBody.saved) throw new Error(`HTTP respond failed with status ${response.status}.`);
				respond.push(performance.now() - started);
			}
			rqCalls = 0;
			console.error(`[benchmark] roots=${projects.length} repeat=${i + 1}/${repeats} complete`);
			if (persist)
				await persist({
					roots: projects.length,
					tasksPerRoot: 100,
					status: i + 1 === repeats ? "measured" : "partial",
					sampleCount: i + 1,
					coldRqCalls,
					warmRqCalls,
					changedRqCalls,
					cacheHit: warmRqCalls.every((calls) => calls === 0),
					changedOnlyOneRoot: changedRqCalls.every((calls) => calls === 1),
					coldAggregate: samples(cold),
					warmAggregate: samples(warm),
					changedToVisibleAggregate: samples(changed),
					material: samples(material),
					respond: samples(respond),
					materialSamples: material,
					respondSamples: respond,
					httpSampleCount: { material: material.length, respond: respond.length },
					productionAggregateWarm: samples(productionAggregateWarm),
					productionNaturalVisible: samples(productionNaturalVisible),
					productionSamples: { aggregateWarm: productionAggregateWarm, naturalVisible: productionNaturalVisible },
				});
		}
		return {
			status: "measured",
			sampleCount: repeats,
			rqCalls: totalRqCalls,
			coldRqCalls,
			warmRqCalls,
			changedRqCalls,
			cacheHit: warmRqCalls.every((calls) => calls === 0),
			changedOnlyOneRoot: changedRqCalls.every((calls) => calls === 1),
			coldAggregate: samples(cold),
			warmAggregate: samples(warm),
			changedToVisibleAggregate: samples(changed),
			material: samples(material),
			respond: respond.length ? samples(respond) : { unavailable: "rq request fixture did not produce a request" },
			materialSamples: material,
			respondSamples: respond,
			httpSampleCount: { material: material.length, respond: respond.length },
			productionAggregateWarm: samples(productionAggregateWarm),
			productionNaturalVisible: samples(productionNaturalVisible),
			productionSamples: {
				aggregateWarm: productionAggregateWarm,
				naturalVisible: productionNaturalVisible,
			},
		};
	} finally {
		console.log = () => undefined;
		try {
			await httpServer.stop();
		} finally {
			console.log = log;
		}
		for (const id of workspaceIds) await removeWorkspace(id).catch(() => undefined);
		if (previousRegistryPath === undefined) delete process.env.BACKLOG_WORKSPACES_FILE;
		else process.env.BACKLOG_WORKSPACES_FILE = previousRegistryPath;
	}
}

const fixtureRoot = await mkdtemp(join(fixtureParent, "backlog-workspace-benchmark-"));
const benchmarkResults: Record<string, unknown> = {};
try {
	console.log(
		JSON.stringify(
			{
				environment: {
					platform: process.platform,
					runtime: process.version,
					bun: Bun.version,
					repeats,
					rq: rq ?? null,
				},
				results: await (async () => {
					const results = benchmarkResults;
					for (const count of rootCounts) {
						const projects = await Promise.all(
							Array.from({ length: count }, (_, index) => fixture(fixtureRoot, index)),
						);
						results[count] = { roots: projects.length, tasksPerRoot: 100, status: "running", sampleCount: 0 };
						await writeFile(
							artifactPath,
							JSON.stringify(
								{
									environment: {
										platform: process.platform,
										runtime: process.version,
										bun: Bun.version,
										repeats,
										rq: rq ?? null,
									},
									results: { [count]: { roots: count, tasksPerRoot: 100, status: "initializing", sampleCount: 0 } },
								},
								null,
								2,
							),
							"utf8",
						);
						results[count] = {
							roots: projects.length,
							tasksPerRoot: 100,
							...(await measure(projects, async (partial) => {
								results[count] = partial;
								await writeFile(
									artifactPath,
									JSON.stringify(
										{
											environment: {
												platform: process.platform,
												runtime: process.version,
												bun: Bun.version,
												repeats,
												rq: rq ?? null,
											},
											results,
										},
										null,
										2,
									),
									"utf8",
								);
							})),
						};
					}
					return results;
				})(),
			},
			null,
			2,
		),
	);
} catch (error) {
	await writeFile(
		artifactPath,
		JSON.stringify(
			{
				environment: {
					platform: process.platform,
					runtime: process.version,
					bun: Bun.version,
					repeats,
					rq: rq ?? null,
				},
				results: benchmarkResults,
				status: "failed",
				failure: error instanceof Error ? error.message : String(error),
			},
			null,
			2,
		),
		"utf8",
	);
	console.error(`Benchmark failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
	for (let attempt = 0; attempt < 10; attempt++) {
		try {
			await rm(fixtureRoot, { recursive: true, force: true });
			break;
		} catch (error) {
			if (attempt === 9)
				console.error(`Fixture cleanup deferred: ${error instanceof Error ? error.message : String(error)}`);
			if (attempt === 9) break;
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}
}

// BacklogServer owns native watchers on some platforms; all fixture work is complete here.
process.exit(0);
