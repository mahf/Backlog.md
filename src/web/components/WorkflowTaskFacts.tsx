import { useEffect, useMemo, useState } from "react";
import { apiClient, type WorkflowRequest, type WorkflowSnapshot } from "../lib/api";

const raw = (item: Record<string, unknown>, ...keys: string[]): unknown => {
	for (const key of keys) if (item[key] !== undefined && item[key] !== null) return item[key];
	return undefined;
};
const text = (item: Record<string, unknown>, ...keys: string[]): string => {
	const value = raw(item, ...keys);
	return typeof value === "string" || typeof value === "number" ? String(value) : "unknown";
};
const identity = (value: unknown): string =>
	typeof value === "string" || typeof value === "number" ? String(value).toUpperCase() : "";
const requestTask = (request: WorkflowRequest): string => text(request, "taskId", "task_id", "ticket", "task");
const requestWorkspace = (request: WorkflowRequest): string =>
	text(request, "workspaceId", "workspace_id", "workspace", "project_id");

function taskWorkspace(task: Record<string, unknown>): string {
	const value = task.workspaceId ?? task.workspace_id ?? task.project_id;
	return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function taskIds(task: Record<string, unknown>): string[] {
	return [task.id, task.original_id, task.ticket].map(identity).filter(Boolean);
}

function taskCandidates(snapshot: WorkflowSnapshot | null, taskId: string): Record<string, unknown>[] {
	return (snapshot?.tasks ?? []).filter((candidate) => taskIds(candidate).includes(identity(taskId)));
}

function matchingTask(
	snapshot: WorkflowSnapshot | null,
	taskId: string,
	workspaceId?: string,
): Record<string, unknown> | undefined {
	const candidates = taskCandidates(snapshot, taskId).filter((candidate) => {
		const candidateWorkspace = taskWorkspace(candidate);
		return (
			taskIds(candidate).includes(identity(taskId)) &&
			(!workspaceId || candidateWorkspace.toUpperCase() === workspaceId.toUpperCase())
		);
	});
	return candidates.length === 1 ? candidates[0] : undefined;
}

function taskReasons(task: Record<string, unknown> | undefined): string {
	const reasons = task?.reasons;
	if (Array.isArray(reasons) && reasons.length > 0) {
		return reasons.map((reason) => (typeof reason === "string" ? reason : JSON.stringify(reason))).join("; ");
	}
	return text(task ?? {}, "waitingReason", "waiting_reason", "reason");
}

function deliveryFact(request: WorkflowRequest, key: string): string {
	const facts = request.facts;
	const source =
		facts && typeof facts === "object" && !Array.isArray(facts)
			? (facts as Record<string, unknown>)
			: (request as Record<string, unknown>);
	const candidate = raw(source, key, `${key}_at`, `${key}At`);
	if (key === "saved")
		return candidate !== undefined
			? String(candidate)
			: text(request, "status") === "answered" && raw(source, "answered_at", "answeredAt")
				? "yes"
				: "unknown";
	if (key === "delivery") {
		const delivery = raw(source, "delivery", "delivery_status");
		if (
			typeof delivery === "string" &&
			["pending", "received", "running", "completed", "unknown", "offline", "mismatch"].includes(delivery)
		)
			return delivery === "pending" ? "pending (not executed)" : delivery;
		return "unknown";
	}
	if (["delivered", "received", "running", "completed"].includes(key)) {
		const status = raw(source, "delivery", "delivery_status");
		if (status === key) return String(raw(source, `${key}_at`, key) ?? key);
		const timestamp = raw(source, `${key}_at`, `${key}At`);
		return timestamp === undefined ? "unknown" : String(timestamp);
	}
	return candidate === undefined ? "unknown" : String(candidate);
}

function factsFor(request: WorkflowRequest): Record<string, string> {
	return {
		saved: deliveryFact(request, "saved"),
		delivery: deliveryFact(request, "delivery"),
		delivered: deliveryFact(request, "delivered"),
		received: deliveryFact(request, "received"),
		running: deliveryFact(request, "running"),
		completed: deliveryFact(request, "completed"),
	};
}

export default function WorkflowTaskFacts({ taskId, workspaceId }: { taskId: string; workspaceId?: string }) {
	const [snapshot, setSnapshot] = useState<WorkflowSnapshot | null>(null);
	const [offline, setOffline] = useState<string | null>(null);
	useEffect(() => {
		let active = true;
		setOffline(null);
		setSnapshot(null);
		apiClient
			.fetchWorkflow(workspaceId)
			.then((value) => {
				if (active) setSnapshot(value);
			})
			.catch((reason) => {
				if (active) {
					setSnapshot(null);
					setOffline(reason instanceof Error ? reason.message : "Workflow unavailable");
				}
			});
		return () => {
			active = false;
		};
	}, [taskId, workspaceId]);
	const candidates = useMemo(() => taskCandidates(snapshot, taskId), [snapshot, taskId]);
	const scopedWorkspaces = useMemo(
		() =>
			new Set(
				candidates
					.map(taskWorkspace)
					.filter(Boolean)
					.map((value) => value.toUpperCase()),
			),
		[candidates],
	);
	const explicitWorkspace = workspaceId?.trim() || undefined;
	const candidateHasMissingWorkspace = candidates.some((candidate) => !taskWorkspace(candidate));
	const ambiguousWorkspace =
		!explicitWorkspace && (scopedWorkspaces.size > 1 || (scopedWorkspaces.size > 0 && candidateHasMissingWorkspace));
	const effectiveWorkspace =
		explicitWorkspace ?? (!ambiguousWorkspace && scopedWorkspaces.size === 1 ? [...scopedWorkspaces][0] : undefined);
	const task = useMemo(() => matchingTask(snapshot, taskId, workspaceId), [snapshot, taskId, workspaceId]);
	const requests = useMemo(() => {
		const reviewItems = (snapshot?.review_items ?? snapshot?.reviewItems ?? []).filter(
			(item) => typeof item.request_id === "string" || typeof item.requestId === "string",
		) as WorkflowRequest[];
		const allRequests = [...(snapshot?.requests ?? []), ...reviewItems];
		const requestWorkspaces = new Set(
			allRequests
				.filter((request) => identity(requestTask(request)) === identity(taskId))
				.map(requestWorkspace)
				.filter((value) => value !== "unknown")
				.map((value) => value.toUpperCase()),
		);
		const requestHasMissingWorkspace = allRequests.some(
			(request) => identity(requestTask(request)) === identity(taskId) && requestWorkspace(request) === "unknown",
		);
		const requestScopeAmbiguous =
			requestWorkspaces.size > 1 || (requestWorkspaces.size > 0 && requestHasMissingWorkspace);
		const requestScope =
			effectiveWorkspace ??
			(!candidates.length && !requestScopeAmbiguous && requestWorkspaces.size === 1
				? [...requestWorkspaces][0]
				: undefined);
		return allRequests.filter((request) => {
			if (identity(requestTask(request)) !== identity(taskId)) return false;
			if (ambiguousWorkspace || (!explicitWorkspace && candidates.length > 0 && requestScopeAmbiguous)) return false;
			const requestedWorkspace = requestWorkspace(request);
			if (requestScope && requestedWorkspace.toUpperCase() !== requestScope.toUpperCase()) return false;
			if (explicitWorkspace && requestedWorkspace === "unknown") return false;
			if (!explicitWorkspace && !requestScope && requestedWorkspace !== "unknown") return false;
			return true;
		});
	}, [snapshot, taskId, candidates, explicitWorkspace, effectiveWorkspace, ambiguousWorkspace]);
	const agents = snapshot?.agents;
	if (!snapshot && offline) {
		const unavailable = offline;
		return (
			<section
				className="mb-4 rounded border border-gray-200 p-3 text-sm dark:border-gray-700"
				aria-label="Workflow session facts"
			>
				<h3 className="font-semibold">Workflow session</h3>
				<div>{unavailable}</div>
			</section>
		);
	}
	const agentItems = Array.isArray(agents) ? agents : (agents?.items ?? []);
	const renderFacts = (record: WorkflowRequest | Record<string, unknown>, key: string) => {
		const request = record as WorkflowRequest;
		const staleValue =
			raw(record as Record<string, unknown>, "stale", "is_stale", "expired") ??
			raw(task ?? {}, "stale", "is_stale", "expired");
		const stale = staleValue === true;
		const session = text(record as Record<string, unknown>, "sessionId", "session_id", "delivery_session");
		const matchingAgents =
			session === "unknown"
				? []
				: agentItems.filter((item) => {
						if (text(item, "sessionId", "session_id", "requestId", "request_id") !== session) return false;
						const itemWorkspace = taskWorkspace(item);
						const itemTaskValue = raw(item, "taskId", "task_id", "ticket", "original_id");
						const itemTaskIdentity = identity(itemTaskValue);
						const hasItemTask = Boolean(itemTaskIdentity && itemTaskIdentity !== "UNKNOWN");
						return (
							(!effectiveWorkspace ||
								!itemWorkspace ||
								itemWorkspace.toUpperCase() === effectiveWorkspace.toUpperCase()) &&
							(!hasItemTask || identity(itemTaskValue) === identity(taskId))
						);
					});
		const agent = matchingAgents.length === 1 ? matchingAgents[0] : undefined;
		const explicitSource = text(record as Record<string, unknown>, "source", "source_type", "session_source");
		const source =
			explicitSource !== "unknown"
				? explicitSource
				: text(task ?? {}, "source", "source_type") !== "unknown"
					? text(task ?? {}, "source", "source_type")
					: text(agent ?? {}, "source", "source_type") !== "unknown"
						? text(agent ?? {}, "source", "source_type")
						: "unknown";
		const observed =
			text(task ?? {}, "updatedAt", "updated_at", "modifiedAt", "modified_at") !== "unknown"
				? text(task ?? {}, "updatedAt", "updated_at", "modifiedAt", "modified_at")
				: text(agent ?? {}, "updatedAt", "updated_at", "last_active", "ts", "collected_at");
		const action = stale ? "unknown" : text(task ?? {}, "action", "currentAction", "current_action");
		const waiting = task ? taskReasons(task) : "unknown";
		const facts = factsFor(request);
		const transport = raw(record as Record<string, unknown>, "transport");
		const deliveryAt = raw(record as Record<string, unknown>, "delivery_at", "deliveryAt");
		const delivery = raw(record as Record<string, unknown>, "delivery", "delivery_status");
		const staleLabel = typeof staleValue === "boolean" ? (stale ? "yes" : "no") : "unknown";
		return (
			<div key={key} className="mt-2 border-t pt-2 dark:border-gray-700">
				<div className="flex flex-wrap gap-2">
					<span>{text(record as Record<string, unknown>, "kind", "type")}</span>
					<span>{effectiveWorkspace ?? (taskWorkspace(task ?? {}) || "unknown")}</span>
					<span>{text(record as Record<string, unknown>, "status", "state")}</span>
				</div>
				<div>
					Action: {action}; waiting: {waiting}
				</div>
				<div>
					Session: {session}; source: {source}; observed: {observed}; updated: {observed}; answered:{" "}
					{text(record as Record<string, unknown>, "answered_at", "answeredAt")}; stale: {staleLabel}
				</div>
				{transport === "input_accepted" && <div>Transport: input accepted (execution not implied)</div>}
				{delivery !== undefined && (
					<div>
						Delivery: {typeof delivery === "string" ? delivery : JSON.stringify(delivery)}
						{deliveryAt !== undefined ? ` at ${String(deliveryAt)}` : ""}
					</div>
				)}
				<div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-6">
					{Object.entries(facts).map(([factKey, fact]) => (
						<span key={factKey}>
							<b>{factKey}</b>: {fact}
						</span>
					))}
				</div>
			</div>
		);
	};
	return (
		<section className="mb-4 rounded border border-gray-200 p-3 text-sm dark:border-gray-700">
			<h3 className="font-semibold">Workflow session</h3>
			{task && !requests.length && renderFacts(task, "task-facts")}
			{requests.map((request, index) =>
				renderFacts(request, `${requestWorkspace(request)}:${text(request, "requestId", "request_id", "id")}:${index}`),
			)}
			{!task && !requests.length && <div>No bound workflow task facts found.</div>}
		</section>
	);
}
