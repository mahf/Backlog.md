import type { BacklogConfig, Task } from "../types/index.ts";
import { isTerminalStatus } from "../utils/terminal-status.ts";
import { runWorkflow } from "./workflow-adapter.ts";

const DELIVERY_FIELDS = [
	"title",
	"description",
	"implementationPlan",
	"implementationNotes",
	"finalSummary",
	"acceptanceCriteriaItems",
	"definitionOfDoneItems",
	"modifiedFiles",
	"references",
	"rawContent",
	"dueDate",
	"priority",
	"type",
	"project",
	"milestone",
	"labels",
	"assignee",
	"dependencies",
	"documentation",
	"parentTaskId",
	"branch",
	"onStatusChange",
] as const;

function deliveryChanged(previous: Task, next: Task): boolean {
	return DELIVERY_FIELDS.some((field) => JSON.stringify(previous[field]) !== JSON.stringify(next[field]));
}

type BoardTask = { original_id?: unknown; source_type?: unknown; status?: unknown };

async function assertBoardIdentity(
	root: string,
	config: BacklogConfig,
	task: Task,
	previous: Task | null,
): Promise<void> {
	const result = await runWorkflow(["board", "--plain"], {
		root,
		enabled: true,
		rq: config.workflow?.rqPath,
		pythonPath: config.workflow?.pythonPath,
	});
	if (result.exitCode !== 0) {
		const detail = (result.stderr || result.stdout || `rq board exited with code ${result.exitCode}`).trim();
		throw new Error(`Workflow gate rejected task ${task.id}: rq board unavailable: ${detail}`);
	}
	let board: { tasks?: unknown; requests?: unknown };
	try {
		board = JSON.parse(result.stdout) as { tasks?: unknown; requests?: unknown };
	} catch {
		throw new Error(`Workflow gate rejected task ${task.id}: rq board returned invalid JSON`);
	}
	if (!Array.isArray(board.tasks) || !Array.isArray(board.requests))
		throw new Error(`Workflow gate rejected task ${task.id}: rq board schema is incomplete`);
	const matches = (board.tasks as unknown[]).filter((value): value is BoardTask => {
		if (!value || typeof value !== "object") return false;
		const candidate = value as BoardTask;
		return (
			String(candidate.original_id ?? "").toLowerCase() === task.id.toLowerCase() &&
			candidate.source_type === "backlog-task"
		);
	});
	if (!previous) {
		if (matches.length > 0)
			throw new Error(`Workflow gate rejected task ${task.id}: rq board already has a target for this new task`);
		throw new Error(
			`Workflow gate rejected task ${task.id}: establish the task in a non-terminal status before marking it complete; rq board has no unique target yet`,
		);
	}
	if (matches.length !== 1)
		throw new Error(`Workflow gate rejected task ${task.id}: rq board task identity is ambiguous or missing`);
	const pending = (board.requests as unknown[]).filter((value) => {
		if (!value || typeof value !== "object") return false;
		const request = value as { ticket?: unknown; source_type?: unknown; status?: unknown };
		return (
			String(request.ticket ?? "").toLowerCase() === task.id.toLowerCase() &&
			request.source_type === "backlog-task" &&
			request.status === "pending"
		);
	});
	if (pending.length > 0) throw new Error(`Workflow gate rejected task ${task.id}: unresolved workflow request`);
}

export async function assertWorkflowTerminalTransition(
	root: string,
	config: BacklogConfig | null,
	previous: Task | null,
	next: Task,
): Promise<void> {
	if (!config?.workflow?.enabled) return;
	const terminal = isTerminalStatus(next.status, config.statuses);
	const wasTerminal = previous ? isTerminalStatus(previous.status, config.statuses) : false;
	if (!terminal || wasTerminal) return;
	if (previous && deliveryChanged(previous, next)) {
		throw new Error(
			`Workflow gate rejected task ${next.id}: save delivery material before marking it complete, then rerun the workflow acceptance check`,
		);
	}
	await assertBoardIdentity(root, config, next, previous);
	const args = ["accept"];
	if (next.milestone) args.push("--milestone", next.milestone);
	const result = await runWorkflow(args, {
		root,
		enabled: true,
		rq: config.workflow.rqPath,
		pythonPath: config.workflow.pythonPath,
	});
	if (result.exitCode !== 0) {
		const detail = (result.stderr || result.stdout || `rq accept exited with code ${result.exitCode}`).trim();
		throw new Error(`Workflow gate rejected task ${next.id}: ${detail}`);
	}
}

/** Keep archive/restore/delete from making an unresolved human request disappear. */
export async function assertWorkflowLifecycleAllowed(
	root: string,
	config: BacklogConfig | null,
	task: Task,
	operation: "archive" | "restore" | "delete" | "demote",
): Promise<void> {
	if (!config?.workflow?.enabled) return;
	const result = await runWorkflow(["board", "--plain"], {
		root,
		enabled: true,
		rq: config.workflow.rqPath,
		pythonPath: config.workflow.pythonPath,
	});
	if (result.exitCode !== 0) {
		const detail = (result.stderr || result.stdout || `rq board exited with code ${result.exitCode}`).trim();
		throw new Error(`Workflow gate rejected ${operation} for task ${task.id}: ${detail}`);
	}
	let board: { tasks?: unknown; requests?: unknown };
	try {
		board = JSON.parse(result.stdout) as { tasks?: unknown; requests?: unknown };
	} catch {
		throw new Error(`Workflow gate rejected ${operation} for task ${task.id}: rq board returned invalid JSON`);
	}
	if (!Array.isArray(board.tasks) || !Array.isArray(board.requests)) {
		throw new Error(`Workflow gate rejected ${operation} for task ${task.id}: rq board schema is incomplete`);
	}
	const matches = board.tasks.filter(
		(value): value is { original_id: unknown; source_type: unknown } =>
			Boolean(value) &&
			typeof value === "object" &&
			"original_id" in value &&
			"source_type" in value &&
			String((value as { original_id: unknown }).original_id).toLowerCase() === task.id.toLowerCase() &&
			String((value as { source_type: unknown }).source_type) === "backlog-task",
	);
	if (matches.length !== 1) {
		throw new Error(
			`Workflow gate rejected ${operation} for task ${task.id}: rq board task identity is ambiguous or missing`,
		);
	}
	const pending = board.requests.filter(
		(value): value is { ticket: unknown; source_type: unknown; status: unknown } =>
			Boolean(value) &&
			typeof value === "object" &&
			"ticket" in value &&
			"source_type" in value &&
			"status" in value &&
			String((value as { ticket: unknown }).ticket).toLowerCase() === task.id.toLowerCase() &&
			String((value as { source_type: unknown }).source_type) === "backlog-task" &&
			String((value as { status: unknown }).status) === "pending",
	);
	if (pending.length > 0) {
		throw new Error(`Workflow gate rejected ${operation} for task ${task.id}: unresolved workflow request`);
	}
}
