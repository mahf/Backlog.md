import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { BoxInterface, ScreenInterface, TextboxInterface } from "neo-neo-bblessed";
import { box, list, scrollablebox, textbox } from "neo-neo-bblessed";
import { runWorkflow, type WorkflowOptions } from "../core/workflow-adapter.ts";
import { addScrollKeys } from "./tui.ts";

type WorkflowRequest = {
	request_id?: string;
	requestId?: string;
	kind?: string;
	ticket?: string;
	question?: string;
	recommendation?: string;
	scope?: string;
	action?: string;
	environment?: string;
	deadline?: string;
	requested_action?: string;
	revision?: string;
	current_revision?: string;
	status?: string;
	actions?: string[];
	approve_blockers?: string[];
	preview?: string[];
	materials?: string[];
	delivery?: string | { status?: string; state?: string };
	saved?: boolean;
	transport?: string;
	delivery_at?: string;
	received_at?: string;
	running_at?: string;
	completed_at?: string;
	answered_at?: string;
	project_id?: string;
	workspace_id?: string;
};

export type WorkflowSnapshot = {
	requests?: WorkflowRequest[];
	tasks?: Array<Record<string, unknown>>;
	agents?: { source?: string; available?: boolean; collected_at?: string; items?: unknown[] };
};

export function parseWorkflowSnapshot(stdout: string): WorkflowSnapshot {
	const value: unknown = JSON.parse(stdout);
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Workflow returned an invalid board snapshot.");
	return value as WorkflowSnapshot;
}

function requestId(request: WorkflowRequest): string {
	return request.request_id ?? request.requestId ?? "";
}

function requestLabel(request: WorkflowRequest): string {
	return `${request.kind ?? "request"} ${request.ticket ?? ""} ${request.question ?? ""}`.trim();
}

export function workflowIdempotencyKey(request: WorkflowRequest, action: string, reply: string): string {
	return createHash("sha256")
		.update(`${requestId(request)}\0${request.revision ?? ""}\0${action}\0${reply}`)
		.digest("hex");
}

export function workflowActions(request: WorkflowRequest): string[] {
	const actions = request.actions ?? [];
	return request.approve_blockers?.length
		? actions.filter((action) => action !== "approve" && action !== "allow")
		: actions;
}

function deliveryState(request: WorkflowRequest): string {
	if (typeof request.delivery === "string") return request.delivery;
	if (request.delivery && typeof request.delivery === "object")
		return request.delivery.status ?? request.delivery.state ?? "";
	return "";
}

function requestValue(request: WorkflowRequest, key: string): string {
	const value = (request as Record<string, unknown>)[key];
	return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
		? String(value)
		: "unknown";
}

function workflowTask(snapshot: WorkflowSnapshot, request: WorkflowRequest): Record<string, unknown> | undefined {
	return snapshot.tasks?.find(
		(candidate) =>
			String(candidate.original_id ?? "").toUpperCase() === String(request.ticket ?? "").toUpperCase() &&
			String(candidate.project_id ?? candidate.workspace_id ?? "") ===
				String(request.project_id ?? request.workspace_id ?? ""),
	);
}

export function workflowRequestVisible(request: WorkflowRequest): boolean {
	if (!requestId(request)) return false;
	if (request.status === "pending") return true;
	return request.status === "answered" && deliveryState(request) !== "completed";
}

export function workflowRevision(request: WorkflowRequest): string {
	const revision = [request.current_revision, request.revision].find((value) => value?.trim()) ?? "";
	return revision.trim() || "unknown";
}

export function workflowMaterials(request: WorkflowRequest): string[] {
	return [...(request.materials?.length ? request.materials : (request.preview ?? []))];
}

export function workflowManualCases(
	snapshot: WorkflowSnapshot,
	request: WorkflowRequest,
): Array<Record<string, unknown>> {
	const task = snapshot.tasks?.find(
		(candidate) =>
			String(candidate.original_id ?? "").toUpperCase() === String(request.ticket ?? "").toUpperCase() &&
			String(candidate.project_id ?? candidate.workspace_id ?? "") ===
				String(request.project_id ?? request.workspace_id ?? ""),
	);
	return Array.isArray(task?.manual_cases)
		? task.manual_cases.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
		: [];
}

function detach(value: unknown): void {
	if (value && typeof value === "object" && "detach" in value && typeof value.detach === "function") value.detach();
}

function isInside(root: string, candidate: string): boolean {
	const rel = relative(resolve(root), resolve(candidate));
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export async function openWorkflowInbox(input: {
	screen: ScreenInterface;
	options: WorkflowOptions & { writable?: boolean; assertWritable?: () => void | Promise<void> };
}): Promise<void> {
	const result = await runWorkflow(["board", "--plain"], input.options);
	if (result.exitCode !== 0) {
		const error = box({
			parent: input.screen,
			top: "center",
			left: "center",
			width: "80%",
			height: 7,
			border: "line",
			label: " Workflow unavailable ",
		}) as BoxInterface;
		box({
			parent: error,
			top: 1,
			left: 2,
			width: "100%-4",
			height: 3,
			content: (result.stderr || result.stdout || "Workflow is unavailable.").trim(),
		});
		error.focus();
		input.screen.render();
		await new Promise<void>((close) =>
			(error as unknown as { key: (keys: string[], callback: () => void) => void }).key(["escape", "q"], () => {
				detach(error);
				close();
				input.screen.render();
			}),
		);
		return;
	}
	let snapshot: WorkflowSnapshot;
	try {
		snapshot = parseWorkflowSnapshot(result.stdout);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const invalid = box({
			parent: input.screen,
			top: "center",
			left: "center",
			width: "80%",
			height: 7,
			border: "line",
			content: message,
		}) as BoxInterface;
		input.screen.render();
		await new Promise<void>((close) =>
			(invalid as unknown as { key: (keys: string[], callback: () => void) => void }).key(["escape", "q"], () => {
				detach(invalid);
				close();
				input.screen.render();
			}),
		);
		return;
	}
	const requests = (snapshot.requests ?? []).filter(workflowRequestVisible);
	const canWrite = input.options.writable !== false;
	const assertWritable = async (): Promise<void> => {
		if (!canWrite) throw new Error("Workflow inbox is read-only for this workspace.");
		await input.options.assertWritable?.();
	};
	const panel = box({
		parent: input.screen,
		top: 1,
		left: 2,
		width: "100%-4",
		height: "100%-2",
		border: "line",
		label: " Human inbox · q close · r refresh · m material · Tab detail · PgUp/PgDn scroll · Enter reply ",
	});
	const rows = list({
		parent: panel,
		top: 1,
		left: 1,
		width: "45%",
		height: "100%-2",
		keys: true,
		vi: true,
		items: requests.map(requestLabel),
		border: "line",
		style: { selected: { fg: "black", bg: "cyan" } },
	});
	const detail = scrollablebox({
		parent: panel,
		top: 1,
		left: "45%",
		width: "55%-2",
		height: "100%-2",
		border: "line",
		tags: true,
		keys: true,
		vi: true,
		alwaysScroll: true,
		mouse: true,
	});
	const checks = new Map<string, Set<string>>();
	const observations = new Map<string, Map<string, string>>();
	const checkRevisions = new Map<string, string>();
	let replyOpen = false;
	let replySubmitting = false;
	let activeReply: TextboxInterface | null = null;
	const replyDrafts = new Map<string, { text: string; actionIndex: number }>();
	let checkOffset = 0;
	let materialOffset = 0;
	let operation = 0;
	const manualCases = (request: WorkflowRequest): Array<Record<string, unknown>> =>
		workflowManualCases(snapshot, request);
	const allChecked = (request: WorkflowRequest): boolean => {
		const cases = manualCases(request);
		const done = checks.get(requestId(request));
		return cases.every((item) => done?.has(String(item.id ?? "")) === true);
	};
	const approvalAction = (action: string): boolean => action === "approve" || action === "allow";
	const hasFailureObservation = (request: WorkflowRequest): boolean =>
		Array.from(observations.get(requestId(request))?.values() ?? []).some((value) => value.trim().length > 0);
	const refresh = async () => {
		const refreshOperation = ++operation;
		const selectedId = requestId(requests[rows.selected ?? 0] ?? {});
		const latestResult = await runWorkflow(["board", "--plain"], input.options);
		if (latestResult.exitCode !== 0) {
			detail.setContent(`Refresh failed; previous inbox retained.\n${latestResult.stderr.trim()}`);
			return;
		}
		let latest: WorkflowSnapshot;
		try {
			latest = parseWorkflowSnapshot(latestResult.stdout);
		} catch (error) {
			detail.setContent(`Refresh returned invalid data.\n${error instanceof Error ? error.message : String(error)}`);
			input.screen.render();
			return;
		}
		if (refreshOperation !== operation) return;
		snapshot = latest;
		requests.splice(0, requests.length, ...(latest.requests ?? []).filter(workflowRequestVisible));
		rows.setItems(requests.map(requestLabel));
		const selectedIndex = requests.findIndex((request) => requestId(request) === selectedId);
		rows.select(selectedIndex >= 0 ? selectedIndex : Math.min(rows.selected ?? 0, Math.max(0, requests.length - 1)));
		renderDetail();
		input.screen.render();
	};
	const renderDetail = () => {
		const request = requests[rows.selected ?? 0];
		if (!request) {
			detail.setContent("No active human requests.");
			return;
		}
		const revision = workflowRevision(request);
		if (checkRevisions.get(requestId(request)) !== revision) {
			checks.delete(requestId(request));
			checkRevisions.set(requestId(request), revision);
		}
		const blockers = request.approve_blockers?.length ? `\nBlockers: ${request.approve_blockers.join("; ")}` : "";
		const cases = manualCases(request);
		const task = workflowTask(snapshot, request);
		const done = checks.get(requestId(request)) ?? new Set<string>();
		const assertionLines = Array.isArray(task?.assertions)
			? task.assertions
					.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
					.map(
						(item) =>
							`- ${String(item.id ?? "unknown")}: ${String(item.text ?? "unknown")} [${String(item.result ?? "unknown")}]`,
					)
					.join("\n")
			: "none";
		const evidence = task?.evidence && typeof task.evidence === "object" ? task.evidence : undefined;
		const evidenceLines = evidence
			? Object.entries(evidence as Record<string, unknown>)
					.map(([key, value]) => `- ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
					.join("\n")
			: "none";
		const requestedAction =
			request.kind === "authorization"
				? (request.requested_action ?? request.question ?? "unknown")
				: (request.action ?? "unknown");
		const facts = [
			`Question: ${request.question ?? "unknown"}`,
			`Recommendation: ${request.recommendation ?? "unknown"}`,
			`Scope: ${request.scope ?? "unknown"}`,
			`Action: ${requestedAction}`,
			`Environment: ${request.environment ?? "unknown"}`,
			`Deadline: ${request.deadline ?? "unknown"}`,
			`Saved: ${request.status === "answered" && request.answered_at ? "yes" : "no"}`,
			`Transport: ${requestValue(request, "transport")}`,
			`Delivery: ${deliveryState(request) || "unknown"}`,
			`Delivery at: ${requestValue(request, "delivery_at")}`,
			`Received at: ${requestValue(request, "received_at")}`,
			`Running at: ${requestValue(request, "running_at")}`,
			`Completed at: ${requestValue(request, "completed_at")}`,
		].join("\n");
		const checklist = cases.length
			? cases
					.slice(checkOffset, checkOffset + 9)
					.map((item, index) => {
						const id = String(item.id ?? "");
						const note = observations.get(requestId(request))?.get(id);
						return `[${done.has(id) ? "x" : " "}] ${checkOffset + index + 1}. ${id} assertion=${item.assertion ?? ""} pre=${item.pre ?? ""} step=${item.step ?? ""} op=${item.op ?? ""} expect=${item.expect ?? ""} actual=${item.actual ?? ""}${note ? ` observation=${note}` : ""}`;
					})
					.join("\n")
			: "none";
		detail.setContent(
			`${requestLabel(request)}\nRevision: ${revision}\n${facts}\nActions: ${(request.actions ?? []).join(", ") || "none"}${blockers}\nAssertions:\n${assertionLines}\nEvidence:\n${evidenceLines}\nMaterials: ${
				workflowMaterials(request)
					.map((material, index) => `${index + 1}. ${material}`)
					.join("\n") || "none"
			}\nManual checks (1-9 toggles, o CASE-ID: observation, [ ] pages):\n${checklist}`,
		);
	};
	renderDetail();
	rows.focus();
	rows.on("select", () => {
		operation += 1;
		materialOffset = 0;
		renderDetail();
	});
	const renderAfterNavigation = () => {
		setTimeout(() => {
			operation += 1;
			materialOffset = 0;
			renderDetail();
			input.screen.render();
		}, 0);
	};
	rows.key(["up", "down", "k", "j", "home", "end"], renderAfterNavigation);
	(rows as { key: (keys: string[], callback: () => void) => void }).key(["r"], () => {
		if (!replyOpen) void refresh();
	});
	(rows as { key: (keys: string[], callback: () => void) => void }).key(["c"], async () => {
		const request = requests[rows.selected ?? 0];
		if (!request || replyOpen) return;
		const requestOperation = ++operation;
		try {
			await assertWritable();
		} catch (error) {
			detail.setContent(error instanceof Error ? error.message : String(error));
			input.screen.render();
			return;
		}
		const result = await runWorkflow(
			["cancel", requestId(request), "--reason", "Cancelled from native inbox"],
			input.options,
		);
		if (requestOperation !== operation || requestId(requests[rows.selected ?? 0] ?? {}) !== requestId(request)) return;
		detail.setContent(result.exitCode === 0 ? "Request cancelled." : `Cancel failed.\n${result.stderr.trim()}`);
		if (result.exitCode === 0) await refresh();
	});
	(rows as { key: (keys: string[], callback: () => void) => void }).key(["s"], async () => {
		const request = requests[rows.selected ?? 0];
		if (!request || replyOpen) return;
		const requestOperation = ++operation;
		try {
			await assertWritable();
		} catch (error) {
			detail.setContent(error instanceof Error ? error.message : String(error));
			input.screen.render();
			return;
		}
		const result = await runWorkflow(["resume", requestId(request)], input.options);
		if (requestOperation !== operation || requestId(requests[rows.selected ?? 0] ?? {}) !== requestId(request)) return;
		detail.setContent(
			result.exitCode === 0 ? `Delivery resumed.\n${result.stdout.trim()}` : `Resume failed.\n${result.stderr.trim()}`,
		);
		input.screen.render();
	});
	for (let index = 1; index <= 9; index += 1) {
		(rows as { key: (keys: string[], callback: () => void) => void }).key([String(index)], () => {
			if (replyOpen) return;
			const request = requests[rows.selected ?? 0];
			const item = request ? manualCases(request)[checkOffset + index - 1] : undefined;
			if (!request || !item) return;
			const done = checks.get(requestId(request)) ?? new Set<string>();
			const id = String(item.id ?? "");
			if (done.has(id)) done.delete(id);
			else done.add(id);
			checks.set(requestId(request), done);
			renderDetail();
			input.screen.render();
		});
	}
	for (const [key, direction] of [
		["[", -9],
		["]", 9],
	] as const) {
		(rows as { key: (keys: string[], callback: () => void) => void }).key([key], () => {
			if (replyOpen) return;
			const request = requests[rows.selected ?? 0];
			if (!request) return;
			checkOffset = Math.max(0, Math.min(Math.max(0, manualCases(request).length - 1), checkOffset + direction));
			renderDetail();
			input.screen.render();
		});
	}
	(rows as { key: (keys: string[], callback: () => void) => void }).key(["o"], () => {
		if (replyOpen) return;
		const request = requests[rows.selected ?? 0];
		const item = request ? manualCases(request)[checkOffset] : undefined;
		if (!request || !item) return;
		const id = String(item.id ?? "");
		const caseIds = new Set(manualCases(request).map((candidate) => String(candidate.id ?? "")));
		const observationInput = textbox({
			parent: panel,
			top: "center",
			left: "50%",
			width: "45%",
			height: 3,
			border: "line",
			inputOnFocus: true,
			label: ` Observation (${id}: note) `,
		}) as TextboxInterface;
		replyOpen = true;
		activeReply = observationInput;
		const existing = observations.get(requestId(request))?.get(id);
		if (existing)
			(observationInput as unknown as { setValue?: (value: string) => void }).setValue?.(`${id}: ${existing}`);
		observationInput.focus();
		const closeObservation = (save: boolean) => {
			if (save) {
				const raw = observationInput.getValue().trim();
				const separator = raw.indexOf(":");
				const targetId = separator > 0 ? raw.slice(0, separator).trim() : "";
				if (!targetId || !caseIds.has(targetId)) {
					detail.setContent(`Unknown manual case. Use an existing ID, for example ${id}: observation.`);
					observationInput.focus();
					input.screen.render();
					return;
				}
				const value = raw.slice(separator + 1).trim();
				const requestObservations = observations.get(requestId(request)) ?? new Map<string, string>();
				if (value) requestObservations.set(targetId, value);
				else requestObservations.delete(targetId);
				observations.set(requestId(request), requestObservations);
				renderDetail();
			}
			replyOpen = false;
			activeReply = null;
			detach(observationInput);
			rows.focus();
			input.screen.render();
		};
		observationInput.key(["escape"], () => closeObservation(true));
		observationInput.key(["enter"], () => closeObservation(true));
		input.screen.render();
	});
	rows.key(["m"], async () => {
		if (replyOpen) return;
		const request = requests[rows.selected ?? 0];
		const materials = request ? workflowMaterials(request) : [];
		const path = materials.length ? materials[materialOffset % materials.length] : undefined;
		if (!request || !path) return;
		const materialOperation = ++operation;
		try {
			const root = await realpath(input.options.root);
			const candidate = await realpath(resolve(input.options.root, path));
			if (materialOperation !== operation || requestId(requests[rows.selected ?? 0] ?? {}) !== requestId(request))
				return;
			if (!isInside(root, candidate)) {
				detail.setContent("Material path is outside the workspace root.");
				input.screen.render();
				return;
			}
			const handle = await open(candidate, "r");
			try {
				const buffer = Buffer.alloc(64 * 1024);
				const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
				const content = buffer.subarray(0, bytesRead);
				if (content.includes(0)) throw new Error("Binary material is not displayed in the terminal.");
				if (materialOperation !== operation || requestId(requests[rows.selected ?? 0] ?? {}) !== requestId(request))
					return;
				detail.setContent(content.toString("utf8"));
				detail.focus();
			} finally {
				await handle.close();
			}
			materialOffset = (materialOffset + 1) % materials.length;
		} catch (error) {
			if (materialOperation !== operation || requestId(requests[rows.selected ?? 0] ?? {}) !== requestId(request))
				return;
			detail.setContent(`Material unavailable.\n${error instanceof Error ? error.message : String(error)}`);
		}
		input.screen.render();
	});
	rows.key(["tab"], () => {
		detail.focus();
		input.screen.render();
	});
	detail.key(["tab"], () => {
		rows.focus();
		input.screen.render();
	});
	detail.key(["escape"], () => {
		rows.focus();
		input.screen.render();
	});
	addScrollKeys(detail, input.screen);
	rows.key(["enter"], () => {
		const request = requests[rows.selected ?? 0];
		const actions = request ? workflowActions(request) : [];
		if (!request || actions.length === 0) return;
		if (!canWrite) {
			detail.setContent("Workflow inbox is read-only for this workspace.");
			input.screen.render();
			return;
		}
		let actionIndex = actions.length === 1 ? 0 : -1;
		const draft = replyDrafts.get(requestId(request));
		if (draft) actionIndex = Math.min(Math.max(0, draft.actionIndex), actions.length - 1);
		replyOpen = true;
		const reply = textbox({
			parent: panel,
			top: "center",
			left: "50%",
			width: "45%",
			height: 3,
			border: "line",
			inputOnFocus: true,
			label: ` Reply (${actionIndex < 0 ? "choose action with Ctrl+A" : actions[actionIndex]}) `,
		}) as TextboxInterface;
		activeReply = reply;
		if (draft?.text) (reply as unknown as { setValue?: (value: string) => void }).setValue?.(draft.text);
		reply.focus();
		reply.key(["escape"], () => {
			const draftText = reply.getValue().trim();
			if (draftText) replyDrafts.set(requestId(request), { text: draftText, actionIndex });
			replyOpen = false;
			activeReply = null;
			detach(reply);
			rows.focus();
			input.screen.render();
		});
		reply.key(["C-a"], () => {
			actionIndex = (actionIndex + 1) % actions.length;
			(reply as unknown as { setLabel: (label: string) => void }).setLabel(` Reply (${actions[actionIndex]}) `);
			input.screen.render();
		});
		reply.key(["enter"], async () => {
			if (replySubmitting) return;
			const text = reply.getValue().trim();
			if (!text || actionIndex < 0) return;
			const action = actions[actionIndex] ?? "answer";
			if (approvalAction(action) && (!allChecked(request) || hasFailureObservation(request))) {
				detail.setContent("Complete every manual check and clear failure observations before approving.");
				input.screen.render();
				return;
			}
			try {
				await assertWritable();
			} catch (error) {
				replyDrafts.set(requestId(request), { text, actionIndex });
				detail.setContent(error instanceof Error ? error.message : String(error));
				input.screen.render();
				return;
			}
			replySubmitting = true;
			const responseOperation = ++operation;
			const requestObservations = observations.get(requestId(request));
			const checked = checks.get(requestId(request));
			const observationText = `\n\nManual checks:\n${manualCases(request)
				.map((item) => {
					const id = String(item.id ?? "");
					const note = requestObservations?.get(id)?.trim();
					return `- ${id}: ${note ? `FAIL ${note}` : checked?.has(id) ? "PASS" : "UNCHECKED"}`;
				})
				.join("\n")}`;
			const canonicalReply = `${text}${observationText}`;
			const key = workflowIdempotencyKey(request, action, canonicalReply);
			const response = await runWorkflow(
				[
					"respond",
					requestId(request),
					canonicalReply,
					"--action",
					action,
					"--expected-revision",
					request.current_revision ?? request.revision ?? "",
					"--idempotency-key",
					key,
				],
				input.options,
			);
			if (responseOperation !== operation) {
				replySubmitting = false;
				return;
			}
			if (response.exitCode !== 0) {
				replyDrafts.set(requestId(request), { text, actionIndex });
				replySubmitting = false;
				detail.setContent(`Response failed; draft preserved for retry.\n${response.stderr.trim()}`);
				input.screen.render();
				return;
			}
			const verified = await runWorkflow(["board", "--plain"], input.options);
			const latest = verified.exitCode === 0 ? parseWorkflowSnapshot(verified.stdout) : undefined;
			if (responseOperation !== operation) {
				replySubmitting = false;
				return;
			}
			const currentRequest = requests[rows.selected ?? 0];
			if (!currentRequest || requestId(currentRequest) !== requestId(request)) {
				replySubmitting = false;
				return;
			}
			const saved = latest?.requests?.some(
				(candidate) =>
					requestId(candidate) === requestId(request) &&
					candidate.status === "answered" &&
					(candidate as WorkflowRequest & { idempotency_key?: string }).idempotency_key === key &&
					(candidate as WorkflowRequest & { reply?: string }).reply === canonicalReply &&
					(candidate as WorkflowRequest & { action?: string }).action === action,
			);
			if (!saved) {
				replySubmitting = false;
				detail.setContent(
					`Response command completed, but saving could not be verified. Retry with the same text.\n${response.stdout.trim()}`,
				);
				input.screen.render();
				return;
			}
			detach(reply);
			replyDrafts.delete(requestId(request));
			replyOpen = false;
			activeReply = null;
			replySubmitting = false;
			const index = requests.findIndex((candidate) => requestId(candidate) === requestId(request));
			if (index >= 0 && latest) {
				const updated = latest.requests?.find((candidate) => requestId(candidate) === requestId(request));
				if (updated && workflowRequestVisible(updated)) requests[index] = updated;
				else requests.splice(index, 1);
			}
			rows.setItems(requests.map(requestLabel));
			detail.setContent(
				`Response saved (idempotency ${key.slice(0, 8)}); delivery may continue.\n${response.stdout.trim()}`,
			);
			input.screen.render();
		});
		input.screen.render();
	});
	input.screen.render();
	await new Promise<void>((closeInbox) => {
		let closed = false;
		const close = () => {
			if (closed) return;
			closed = true;
			detach(panel);
			closeInbox();
			input.screen.render();
		};
		const closeFromFocusedList = () => {
			if (replyOpen) {
				activeReply?.focus();
				return;
			}
			close();
		};
		// Blessed sends keypresses to the focused list, not its parent panel.
		rows.key(["escape", "q"], closeFromFocusedList);
		(panel as { key: (keys: string[], callback: () => void) => void }).key(["escape", "q"], closeFromFocusedList);
	});
}
