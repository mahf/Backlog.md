import type { Command } from "commander";
import { Core } from "../core/backlog.ts";
import {
	runWorkflow,
	type WorkflowCommandResult,
	type WorkflowOptions,
	workflowAvailability,
} from "../core/workflow-adapter.ts";
import {
	applyWorkflowMigration,
	previewWorkflowMigration,
	recoverWorkflowMigration,
	rollbackWorkflowMigration,
} from "../core/workflow-migration.ts";
import { assertWorkspaceWritable, resolveWorkspaceRoot } from "../core/workspace-context.ts";

type WorkflowCliOptions = {
	workspace?: string;
	cwd?: string;
	allWorkspaces?: boolean;
	json?: boolean;
	[key: string]: unknown;
};

async function options(
	value: WorkflowCliOptions,
	mutation = false,
): Promise<WorkflowOptions & { workspaceId?: string }> {
	if (value.allWorkspaces)
		throw new Error("Workflow commands require one explicit workspace; aggregate writes are not supported.");
	const currentDirectory = value.cwd?.trim() || process.env.BACKLOG_CWD?.trim() || process.cwd();
	const selected = await resolveWorkspaceRoot({ workspace: value.workspace, allWorkspaces: false }, currentDirectory);
	if (mutation) assertWorkspaceWritable(selected.workspace, "workflow mutation");
	const config = await new Core(selected.rootPath).filesystem.loadConfig();
	if (!config) throw new Error(`No Backlog.md project found at ${selected.rootPath}.`);
	return {
		root: selected.rootPath,
		enabled: config.workflow?.enabled ?? false,
		rq: config.workflow?.rqPath,
		pythonPath: config.workflow?.pythonPath,
		workspaceId: selected.workspace?.id,
	};
}

function common(command: Command): Command {
	return command
		.option("--workspace <id>", "registered workspace identifier")
		.option("--cwd <path>", "project directory used when --workspace is omitted")
		.option("--all-workspaces", "reject aggregate workflow operations")
		.option("--json", "machine-readable output")
		.hook("preAction", (current) => inheritWorkflowOptions(current));
}

function inheritWorkflowOptions(command: Command): void {
	const options = command.opts<Record<string, unknown>>();
	for (let parent = command.parent; parent; parent = parent.parent) {
		const inherited = parent.opts<Record<string, unknown>>();
		for (const key of ["workspace", "cwd", "allWorkspaces", "json"])
			if (options[key] === undefined && inherited[key] !== undefined) options[key] = inherited[key];
	}
}

function strictBoolean(value: string): boolean {
	if (value === "true") return true;
	if (value === "false") return false;
	throw new Error("--enabled must be true or false.");
}

type ResponseIdentity = { requestId: string; reply: string; action: string; idempotencyKey: string };

async function responseFacts(result: WorkflowCommandResult, options: WorkflowOptions, identity: ResponseIdentity) {
	const board = await runWorkflow(["board", "--plain"], options);
	if (board.exitCode !== 0) return {};
	try {
		const snapshot = JSON.parse(board.stdout) as { requests?: unknown };
		const request = Array.isArray(snapshot.requests)
			? snapshot.requests.find((item): item is Record<string, unknown> => {
					if (!item || typeof item !== "object") return false;
					const row = item as Record<string, unknown>;
					return (
						row.request_id === identity.requestId &&
						row.reply === identity.reply &&
						row.action === identity.action &&
						row.idempotency_key === identity.idempotencyKey &&
						row.status === "answered"
					);
				})
			: undefined;
		if (!request) return {};
		return {
			saved: true,
			projectionPending:
				result.stdout.includes("投影待修复") || result.stdout.toLowerCase().includes("projection pending"),
		};
	} catch {
		return {};
	}
}

function printResult(
	result: WorkflowCommandResult,
	json: boolean,
	workspaceId?: string,
	response?: { saved?: boolean; projectionPending?: boolean },
): void {
	if (json) {
		let data: unknown = result.stdout;
		try {
			data = result.stdout.trim() ? JSON.parse(result.stdout) : null;
		} catch {
			/* rq mutation output is intentionally human-readable. */
		}
		console.log(
			JSON.stringify({
				ok: result.exitCode === 0,
				exitCode: result.exitCode,
				workspaceId,
				data,
				stdout: result.stdout,
				stderr: result.stderr,
				...(response ? response : {}),
			}),
		);
	} else {
		if (result.stdout) process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
		if (result.exitCode !== 0 && result.stderr)
			process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`);
	}
	if (result.exitCode !== 0) process.exitCode = result.exitCode;
}

async function run(
	args: string[],
	value: WorkflowCliOptions,
	mutation = false,
	identity?: ResponseIdentity,
): Promise<void> {
	const resolved = await options(value, mutation);
	const result = await runWorkflow(args, resolved);
	const response =
		value.json && identity && result.exitCode === 0 ? await responseFacts(result, resolved, identity) : undefined;
	printResult(result, Boolean(value.json), resolved.workspaceId, response);
}

export function registerWorkflowCommand(program: Command): void {
	const workflow = program
		.command("workflow")
		.description("Use the configured rq workflow without changing native task state")
		.option("--workspace <id>", "registered workspace identifier")
		.option("--cwd <path>", "project directory used when --workspace is omitted")
		.option("--all-workspaces", "reject aggregate workflow operations")
		.option("--json", "machine-readable output");
	workflow.hook("preAction", (command) => inheritWorkflowOptions(command));
	const config = common(workflow.command("config").description("Read or update rq workflow integration settings"));
	config
		.option("--enabled <boolean>")
		.option("--rq-path <path>")
		.option("--python-path <path>")
		.action(async (value) => {
			const hasChanges = value.enabled !== undefined || value.rqPath !== undefined || value.pythonPath !== undefined;
			const resolved = await options(value, hasChanges);
			const core = new Core(resolved.root);
			const existing = await core.filesystem.loadConfig();
			if (!existing) throw new Error(`No Backlog.md project found at ${resolved.root}.`);
			if (hasChanges) {
				const current = existing.workflow ?? { enabled: false };
				await core.filesystem.saveConfig({
					...existing,
					workflow: {
						enabled: value.enabled === undefined ? current.enabled : strictBoolean(value.enabled),
						rqPath: value.rqPath === undefined ? current.rqPath : value.rqPath || undefined,
						pythonPath: value.pythonPath === undefined ? current.pythonPath : value.pythonPath || undefined,
					},
				});
			}
			const latest = await core.filesystem.loadConfig();
			const state = {
				enabled: latest?.workflow?.enabled ?? false,
				rqPath: latest?.workflow?.rqPath,
				pythonPath: latest?.workflow?.pythonPath,
				workspaceId: resolved.workspaceId,
			};
			if (value.json) console.log(JSON.stringify(state));
			else console.log(`${state.enabled}\t${state.rqPath ?? ""}\t${state.pythonPath ?? ""}`);
		});
	common(workflow.command("status").description("Show workflow readiness")).action(async (value) => {
		const resolved = await options(value);
		const state = await workflowAvailability(resolved);
		if (value.json) console.log(JSON.stringify({ ...state, workspaceId: resolved.workspaceId }));
		else
			console.log(
				`${state.enabled ? "enabled" : "disabled"}\t${state.available ? "ready" : "unavailable"}\t${state.message}`,
			);
		if (!state.available && state.enabled) process.exitCode = 2;
	});
	common(workflow.command("inbox").description("List pending workflow requests")).action((value) =>
		run(["inbox"], value),
	);
	common(workflow.command("card <ticket>").description("Show workflow material and readiness for a ticket")).action(
		(ticket, value) => run(["card", ticket], value),
	);
	common(workflow.command("board").description("Print the workflow snapshot")).action((value) =>
		run(["board", "--plain"], value),
	);

	const request = common(
		workflow.command("request <ticket> <kind> <question>").description("Create a durable human request"),
	);
	request
		.option("--recommendation <text>")
		.option("--scope <text>")
		.option("--revision <revision>")
		.option("--session-id <id>")
		.option("--decision-id <id>")
		.option("--subject-key <path>")
		.option("--request-id <id>")
		.option("--supersedes <id>")
		.action(async (ticket, kind, question, value) => {
			const args = ["request", ticket, kind, question];
			for (const [flag, key] of [
				["--recommendation", "recommendation"],
				["--scope", "scope"],
				["--revision", "revision"],
				["--session-id", "sessionId"],
				["--decision-id", "decisionId"],
				["--subject-key", "subjectKey"],
				["--request-id", "requestId"],
				["--supersedes", "supersedes"],
			] as const)
				if (value[key]) args.push(flag, value[key]);
			await run(args, value, true);
		});
	const respond = common(
		workflow.command("respond <requestId> <reply>").description("Submit a request answer through rq"),
	);
	respond
		.option("--action <action>")
		.option("--expected-revision <revision>")
		.option("--by <actor>")
		.option("--idempotency-key <key>")
		.action(async (requestId, reply, value) => {
			const args = ["respond", requestId, reply];
			for (const [flag, key] of [
				["--action", "action"],
				["--expected-revision", "expectedRevision"],
				["--by", "by"],
				["--idempotency-key", "idempotencyKey"],
			] as const)
				if (value[key]) args.push(flag, value[key]);
			await run(args, value, true, {
				requestId,
				reply,
				action: value.action || "answer",
				idempotencyKey: value.idempotencyKey || "",
			});
		});
	const cancel = common(workflow.command("cancel <requestId>").description("Cancel a request and retain its history"));
	cancel
		.requiredOption("--reason <reason>")
		.option("--by <actor>")
		.action(async (requestId, value) => {
			const args = ["cancel", requestId, "--reason", value.reason];
			if (value.by) args.push("--by", value.by);
			await run(args, value, true);
		});
	const review = common(workflow.command("review <ticket> <verdict>").description("Submit a review decision"));
	review
		.requiredOption("--note <note>")
		.option("--by <actor>")
		.option("--waive <reason>")
		.option("--force")
		.option("--expected-revision <revision>")
		.action(async (ticket, verdict, value) => {
			const args = ["review", ticket, verdict, "--note", value.note];
			for (const [flag, key] of [
				["--by", "by"],
				["--waive", "waive"],
				["--expected-revision", "expectedRevision"],
			] as const)
				if (value[key]) args.push(flag, value[key]);
			if (value.force) args.push("--force");
			await run(args, value, true);
		});
	const decide = common(
		workflow.command("decide <ticket> <number> <decision>").description("Answer a ticket decision"),
	);
	decide.option("--by <actor>").action(async (ticket, number, decision, value) => {
		const args = ["decide", ticket, number, decision];
		if (value.by) args.push("--by", value.by);
		await run(args, value, true);
	});
	const accept = common(workflow.command("accept").description("Check milestone readiness"))
		.option("--milestone <name>")
		.option("--write")
		.option("--by <actor>");
	accept.action(async (value) => {
		const args = ["accept"];
		for (const [flag, key] of [
			["--milestone", "milestone"],
			["--by", "by"],
		] as const)
			if (value[key]) args.push(flag, value[key]);
		if (value.write) args.push("--write");
		await run(args, value, Boolean(value.write));
	});
	common(workflow.command("resume <requestId>").description("Deliver a saved workflow answer")).action(
		(requestId, value) => run(["resume", requestId], value, true),
	);
	const ack = common(workflow.command("ack <requestId>").description("Record explicit workflow delivery progress"));
	ack
		.requiredOption("--session <id>")
		.requiredOption("--claim <claim>")
		.requiredOption("--state <state>")
		.requiredOption("--note <note>");
	ack.action((requestId, value) =>
		run(
			[
				"ack",
				requestId,
				"--session",
				value.session,
				"--claim",
				value.claim,
				"--state",
				value.state,
				"--note",
				value.note,
			],
			value,
			true,
		),
	);
	common(workflow.command("rebuild <target>").description("Rebuild workflow projections from the ledger")).action(
		(target, value) => run(["rebuild", target], value, true),
	);
	const migration = workflow.command("migration").description("Preview or apply ticket-to-task migration");
	common(migration.command("preview").description("Show a read-only migration plan")).action(async (value) => {
		const resolved = await options(value);
		const plan = await previewWorkflowMigration(resolved.root);
		if (value.json) console.log(JSON.stringify(plan));
		else {
			console.log(`fingerprint\t${plan.fingerprint}`);
			console.log(`target\t${plan.target}`);
			for (const record of plan.records)
				console.log(
					`${record.source}\t${record.id}\t${record.sourcePath}\t${record.targetPath}\t${record.conflicts.join(" | ")}`,
				);
			for (const conflict of plan.conflicts) console.log(`conflict\t${conflict}`);
		}
	});
	const apply = common(migration.command("apply").description("Apply a reviewed migration plan"));
	apply.requiredOption("--confirm").requiredOption("--fingerprint <fingerprint>");
	apply.action(async (value) => {
		if (!value.workspace) throw new Error("Migration apply requires one explicit --workspace.");
		const resolved = await options(value, true);
		const plan = await previewWorkflowMigration(resolved.root);
		const result = await applyWorkflowMigration(plan, {
			confirm: Boolean(value.confirm),
			fingerprint: value.fingerprint,
			workspace: value.workspace,
		});
		if (value.json) console.log(JSON.stringify(result));
		else console.log(`moved\t${result.moved}\tjournal\t${result.journal}`);
	});
	const recover = common(migration.command("recover <fingerprint>").description("Recover an interrupted migration"));
	recover.action(async (fingerprint, value) => {
		if (!value.workspace) throw new Error("Migration recovery requires one explicit --workspace.");
		const resolved = await options(value, true);
		await recoverWorkflowMigration(resolved.root, fingerprint);
		if (value.json) console.log(JSON.stringify({ ok: true, fingerprint }));
		else console.log(`recovered\t${fingerprint}`);
	});
	const rollback = common(migration.command("rollback <fingerprint>").description("Rollback a migration"));
	rollback.action(async (fingerprint, value) => {
		if (!value.workspace) throw new Error("Migration rollback requires one explicit --workspace.");
		const resolved = await options(value, true);
		await rollbackWorkflowMigration(resolved.root, fingerprint);
		if (value.json) console.log(JSON.stringify({ ok: true, fingerprint }));
		else console.log(`rolled-back\t${fingerprint}`);
	});
}
