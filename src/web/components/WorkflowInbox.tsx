import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiClient, type WorkflowRequest, type WorkflowResult, type WorkflowSnapshot } from "../lib/api";
import type { WorkflowManualCase } from "./WorkflowRequestChecks";
import WorkflowRequestChecks from "./WorkflowRequestChecks";

type RequestWithIdentity = WorkflowRequest & { requestId: string };

const value = (request: WorkflowRequest, ...keys: string[]): string => {
	for (const key of keys) {
		const current = request[key];
		if (typeof current === "string" || typeof current === "number") return String(current);
	}
	return "";
};

const requestId = (request: WorkflowRequest): string => value(request, "requestId", "request_id", "id");
const requestKind = (request: WorkflowRequest): string => value(request, "kind", "type") || "request";
const requestRevision = (request: WorkflowRequest): string =>
	value(request, "currentRevision", "current_revision", "revision") || "unknown";
const workspaceId = (request: WorkflowRequest): string =>
	value(request, "workspaceId", "workspace_id", "workspace") || "unknown";
const taskId = (request: WorkflowRequest): string => value(request, "taskId", "task_id", "ticket", "task") || "unknown";
const requestKey = (request: WorkflowRequest): string => `${workspaceId(request)}:${requestId(request)}`;
const caseKey = (item: WorkflowManualCase, index: number): string => item.id?.trim() || `case-${index + 1}`;
const actionsFor = (request: WorkflowRequest): string[] => {
	const base =
		Array.isArray(request.actions) && request.actions.every((item) => typeof item === "string")
			? (request.actions as string[])
			: ({
					decision: ["recommendation", "custom"],
					review: ["approve", "changes"],
					acceptance: ["approve", "changes"],
					authorization: ["allow", "deny", "changes"],
				}[requestKind(request)] ?? ["answer"]);
	const blockers = request.approve_blockers;
	return Array.isArray(blockers) && blockers.length
		? base.filter((option) => option !== "approve" && option !== "allow")
		: base;
};
const defaultAction = (request: WorkflowRequest): string => actionsFor(request)[0] ?? "answer";

function normalizeRequests(snapshot: WorkflowSnapshot | null): RequestWithIdentity[] {
	const requests = snapshot?.requests ?? [];
	const reviewItems = snapshot?.review_items ?? snapshot?.reviewItems ?? [];
	const taskByKey = new Map(
		(snapshot?.tasks ?? []).flatMap((task) => {
			const project = String(task.workspaceId ?? task.workspace_id ?? task.project_id ?? "unknown");
			const ids = [task.original_id, task.id, task.ticket].filter(
				(id): id is string | number => typeof id === "string" || typeof id === "number",
			);
			return ids.map((id) => [`${project}:${String(id)}`, task] as const);
		}),
	);
	const combined: WorkflowRequest[] = [
		...requests,
		...reviewItems
			.filter((item) => typeof item.requestId === "string" || typeof item.request_id === "string")
			.map((item) => item as WorkflowRequest),
	];
	return combined
		.map((request) => {
			const task = taskByKey.get(`${workspaceId(request)}:${taskId(request)}`) ?? {};
			const authorizationAction =
				requestKind(request) === "authorization"
					? value(request, "action", "requestedAction", "requested_action") || request.question || "unknown"
					: undefined;
			return {
				...task,
				...request,
				requestId: requestId(request),
				checklist: request.checklist ?? (task.manual_cases as WorkflowRequest["manual_cases"]),
				manual_cases: request.manual_cases ?? (task.manual_cases as WorkflowRequest["manual_cases"]),
				assertions: request.assertions ?? (task.assertions as WorkflowRequest["assertions"]),
				evidence: request.evidence ?? (task.evidence as WorkflowRequest["evidence"]),
				...(authorizationAction ? { action: authorizationAction } : {}),
			};
		})
		.filter((request) => request.requestId.length > 0);
}

function isActionable(request: WorkflowRequest): boolean {
	if (request.actionable === false) return false;
	const state = value(request, "status", "state").toLowerCase();
	if (state === "answered") {
		const delivery = request.delivery;
		const deliveryState = (
			typeof delivery === "string"
				? delivery
				: (delivery?.status ?? delivery?.state ?? value(request, "delivery_status"))
		).toLowerCase();
		return deliveryState !== "completed";
	}
	return (
		!state ||
		(["pending", "ready", "human_ready", "open", "awaiting_human"].includes(state) &&
			!["cancelled", "canceled", "superseded"].includes(state))
	);
}

function isWritable(request: WorkflowRequest, writable: Set<string>, aggregate: boolean): boolean {
	return writable.has(workspaceId(request)) && (!aggregate || workspaceId(request) !== "unknown");
}

function deliveryState(request: WorkflowRequest): string {
	const delivery = request.delivery;
	return (
		typeof delivery === "string" ? delivery : (delivery?.status ?? delivery?.state ?? value(request, "delivery_status"))
	).toLowerCase();
}

function canRespond(request: WorkflowRequest, writable: Set<string>, aggregate: boolean): boolean {
	const state = value(request, "status", "state").toLowerCase();
	return (
		isWritable(request, writable, aggregate) &&
		state !== "answered" &&
		!["cancelled", "canceled", "superseded"].includes(state) &&
		request.materialMissing !== true &&
		request.material_missing !== true &&
		actionsFor(request).length > 0
	);
}

function resultFact(result: WorkflowResult | null | undefined, key: string): string {
	if (result && key === "transport" && typeof result.transport === "string") return result.transport;
	if (result && key === "delivery_at" && typeof (result.delivery_at ?? result.deliveryAt) === "string")
		return result.delivery_at ?? result.deliveryAt ?? "unknown";
	const data = result?.data;
	if (data && typeof data === "object" && !Array.isArray(data)) {
		const value = (data as Record<string, unknown>)[key] ?? (data as Record<string, unknown>)[`${key}_at`];
		if (typeof value === "string" || typeof value === "number") return String(value);
	}
	return "unknown";
}

function materialText(result: WorkflowResult | null): string {
	if (!result) return "Loading material…";
	if (typeof result.content === "string") return result.content;
	if (typeof result.data === "object" && result.data !== null && !Array.isArray(result.data)) {
		const content = (result.data as Record<string, unknown>).content;
		if (typeof content === "string") return content;
	}
	return result.stdout || result.stderr || "No material returned.";
}

function materialPaths(request: WorkflowRequest): string[] {
	return Array.from(
		new Set(
			[request.materials, request.preview]
				.flatMap((item) => (Array.isArray(item) ? item : [item]))
				.filter((item): item is string => typeof item === "string" && item.trim().length > 0),
		),
	);
}

function machineEvidence(request: WorkflowRequest): Record<string, unknown> {
	if (request.evidence && !Array.isArray(request.evidence) && typeof request.evidence === "object")
		return request.evidence;
	if (Array.isArray(request.evidence))
		return Object.fromEntries(
			request.evidence.map((item, index) => [
				item.label || item.name || `evidence-${index + 1}`,
				item.value ?? item.result ?? item.passed ?? "unknown",
			]),
		);
	return {};
}

function SessionSummary({ request, agents }: { request: WorkflowRequest; agents?: WorkflowSnapshot["agents"] }) {
	const id = value(request, "sessionId", "session_id", "requestId", "request_id");
	const project = workspaceId(request);
	const source = value(request, "source", "session_source") || (!Array.isArray(agents) ? agents?.source : undefined);
	const collected = !Array.isArray(agents) ? agents?.collected_at : undefined;
	const items = Array.isArray(agents) ? agents : (agents?.items ?? []);
	const agent = items.find(
		(item) =>
			value(item as WorkflowRequest, "sessionId", "session_id", "requestId", "request_id") === id &&
			(value(item as WorkflowRequest, "workspaceId", "workspace_id", "project_id") || project) === project,
	);
	return (
		<div className="rounded border border-gray-200 p-3 text-sm dark:border-gray-700">
			<b>Agent/session</b>
			<div>Binding: {id || "unknown"}</div>
			<div>
				Action:{" "}
				{agent ? value(agent as WorkflowRequest, "action", "currentAction", "current_action") || "unknown" : "unknown"}
			</div>
			<div>
				Waiting:{" "}
				{agent ? value(agent as WorkflowRequest, "waitingReason", "waiting_reason", "reason") || "unknown" : "unknown"}
			</div>
			<div>
				Updated:{" "}
				{agent
					? value(agent as WorkflowRequest, "updatedAt", "updated_at", "last_active", "ts") || collected || "unknown"
					: "unknown"}
			</div>
			<div>Source: {source || "unknown"}</div>
		</div>
	);
}

function fact(request: WorkflowRequest, key: string): string {
	const facts = request.facts;
	if (facts && typeof facts === "object" && !Array.isArray(facts)) {
		const current = (facts as Record<string, unknown>)[key];
		if (typeof current === "string" || typeof current === "number") return String(current);
	}
	if (
		key === "saved" &&
		value(request, "status", "state").toLowerCase() === "answered" &&
		value(request, "answered_at", "answeredAt")
	)
		return "yes";
	if (key === "delivery") {
		const deliveryValue = request.delivery;
		const delivery = (
			typeof deliveryValue === "string"
				? deliveryValue
				: (deliveryValue?.status ?? deliveryValue?.state ?? value(request, "delivery_status"))
		).toLowerCase();
		return delivery === "pending" ? "pending (not executed)" : delivery || "unknown";
	}
	if (key === "transport") return value(request, "transport") || "unknown";
	if (key === "delivery_at") return value(request, "delivery_at", "deliveryAt") || "unknown";
	return value(request, key, `${key}At`, `${key}_at`) || "unknown";
}

function WorkflowFacts({ request, result }: { request: WorkflowRequest; result?: WorkflowResult | null }) {
	const labels = ["saved", "transport", "delivery", "delivery_at", "delivered", "received", "running", "completed"];
	return (
		<div className="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300 sm:grid-cols-5">
			{labels.map((label) => (
				<div key={label} className="rounded border border-gray-200 px-2 py-1 dark:border-gray-700">
					<div className="font-medium capitalize">{label}</div>
					<div>
						{result && label === "saved"
							? result.saved === true
								? "yes"
								: result.saved === false
									? "no"
									: "unknown"
							: result && resultFact(result, label) !== "unknown"
								? resultFact(result, label)
								: fact(request, label)}
					</div>
				</div>
			))}
		</div>
	);
}

function DetailSection({ title, items }: { title: string; items?: unknown[] }) {
	if (!items?.length) return null;
	return (
		<section className="space-y-2">
			<h3 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
			<ul className="list-disc space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
				{items.map((item, index) => (
					<li key={index}>{typeof item === "string" ? item : JSON.stringify(item)}</li>
				))}
			</ul>
		</section>
	);
}

export default function WorkflowInbox({
	workspaces = [],
}: {
	workspaces?: Array<{ id: string; name: string; writable: boolean; error?: string }>;
}) {
	const [searchParams] = useSearchParams();
	const scope = searchParams.get("workspace") ?? "";
	const aggregate = scope === "all";
	const [snapshot, setSnapshot] = useState<WorkflowSnapshot | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [selectedKey, setSelectedKey] = useState("");
	const [queuedKeys, setQueuedKeys] = useState<Set<string>>(new Set());
	const [kindFilter, setKindFilter] = useState("");
	const [projectFilter, setProjectFilter] = useState("");
	const [query, setQuery] = useState("");
	const [reply, setReply] = useState("");
	const [action, setAction] = useState("answer");
	const [checks, setChecks] = useState<Record<string, boolean>>({});
	const [observations, setObservations] = useState<Record<string, string>>({});
	const [expandedMaterial, setExpandedMaterial] = useState(false);
	const [material, setMaterial] = useState<WorkflowResult | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [result, setResult] = useState<WorkflowResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [revisionNotice, setRevisionNotice] = useState<string | null>(null);
	const selectedRevisionRef = useRef<{ key: string; revision: string } | null>(null);
	const attemptRef = useRef<{ fingerprint: string; key: string } | null>(null);
	const latestScopeRef = useRef(scope);
	const selectedKeyRef = useRef(selectedKey);
	latestScopeRef.current = scope;
	selectedKeyRef.current = selectedKey;
	const writable = useMemo(
		() =>
			new Set(
				workspaces.filter((workspace) => workspace.writable && !workspace.error).map((workspace) => workspace.id),
			),
		[workspaces],
	);
	const refreshWorkflow = useCallback(
		async (force = false) => {
			const next = await apiClient.fetchWorkflow(scope === "all" ? "all" : scope || undefined, force);
			if (latestScopeRef.current === scope) setSnapshot(next);
			return next;
		},
		[scope],
	);

	useEffect(() => {
		let active = true;
		setSnapshot(null);
		setSelectedKey("");
		setResult(null);
		setMaterial(null);
		setError(null);
		setLoadError(null);
		refreshWorkflow().catch((reason) => {
			if (active) setLoadError(reason instanceof Error ? reason.message : "Workflow facts unavailable");
		});
		return () => {
			active = false;
		};
	}, [refreshWorkflow, scope]);

	useEffect(() => {
		const timer = window.setInterval(() => {
			void refreshWorkflow().catch(() => undefined);
		}, 10000);
		return () => window.clearInterval(timer);
	}, [refreshWorkflow, scope]);

	const requests = useMemo(() => normalizeRequests(snapshot).filter(isActionable), [snapshot]);
	const projects = useMemo(
		() => Array.from(new Set(requests.map(workspaceId).filter((id) => id !== "unknown"))),
		[requests],
	);
	const visible = useMemo(
		() =>
			requests.filter((request) => {
				const text = `${request.question ?? ""} ${request.recommendation ?? ""} ${taskId(request)}`.toLowerCase();
				return (
					(!kindFilter || requestKind(request) === kindFilter) &&
					(!projectFilter || workspaceId(request) === projectFilter) &&
					(!query || text.includes(query.toLowerCase()))
				);
			}),
		[requests, kindFilter, projectFilter, query],
	);
	const selected = visible.find((request) => requestKey(request) === selectedKey) ?? visible[0];
	const selectedState = selected ? value(selected, "status", "state").toLowerCase() : "";
	const selectedWritable = selected ? canRespond(selected, writable, aggregate) : false;
	const selectedRecoveryWritable = selected ? isWritable(selected, writable, aggregate) : false;
	const checklist = (selected?.checklist ?? selected?.manual_cases ?? []) as NonNullable<
		WorkflowRequest["manual_cases"]
	>;
	const allChecked = checklist.length === 0 || checklist.every((item, index) => checks[caseKey(item, index)] === true);
	const requiresChecks = action === "approve" || action === "allow";
	const hasObservations = checklist.some((item, index) => Boolean(observations[caseKey(item, index)]?.trim()));

	useEffect(() => {
		if (!selected) {
			selectedKeyRef.current = "";
			return;
		}
		setSelectedKey(requestKey(selected));
		selectedKeyRef.current = requestKey(selected);
		setReply("");
		setAction(defaultAction(selected));
		setChecks({});
		setObservations({});
		setError(null);
		setRevisionNotice(null);
		setExpandedMaterial(false);
		setMaterial(null);
		setResult(null);
		const key = `backlog.workflow.draft:${workspaceId(selected)}:${taskId(selected)}:${selected.requestId}`;
		const draft = localStorage.getItem(key);
		if (draft) {
			try {
				const saved = JSON.parse(draft) as {
					reply?: string;
					text?: string;
					revision?: string;
					observations?: Record<string, string>;
				};
				setReply(saved.text ?? saved.reply ?? "");
				setObservations(saved.observations ?? {});
				if (saved.revision && saved.revision !== requestRevision(selected))
					setRevisionNotice("This saved draft references an older revision; checks were not restored.");
			} catch {
				setReply(draft);
			}
		}
	}, [selected?.requestId, selected ? workspaceId(selected) : "", selected ? taskId(selected) : ""]);

	useEffect(() => {
		if (!selected) return;
		const revision = requestRevision(selected);
		const prior = selectedRevisionRef.current;
		if (prior && prior.key === requestKey(selected) && prior.revision !== revision) {
			setChecks({});
			setRevisionNotice("This request changed while open. Checks were cleared; review the text before answering.");
		}
		selectedRevisionRef.current = { key: requestKey(selected), revision };
	}, [
		selected?.requestId,
		selected?.workspaceId,
		selected?.currentRevision,
		selected?.current_revision,
		selected?.revision,
	]);

	useEffect(() => {
		if (!selected) return;
		const key = `backlog.workflow.draft:${workspaceId(selected)}:${taskId(selected)}:${selected.requestId}`;
		if (reply || Object.keys(observations).length > 0)
			localStorage.setItem(key, JSON.stringify({ text: reply, revision: requestRevision(selected), observations }));
		else localStorage.removeItem(key);
	}, [reply, observations, selected]);

	const submit = async () => {
		if (
			!selected ||
			!selectedWritable ||
			!reply.trim() ||
			(requiresChecks && (!allChecked || hasObservations)) ||
			submitting
		)
			return;
		const key = requestKey(selected);
		setSubmitting(true);
		setError(null);
		try {
			const humanOutcomes = checklist.length
				? checklist
						.map((item, index) => {
							const id = caseKey(item, index);
							const outcome = checks[id] === true ? "PASS" : observations[id]?.trim() ? "FAIL" : "UNCHECKED";
							return `${id}: ${outcome}${observations[id]?.trim() ? ` — ${observations[id].trim()}` : ""}`;
						})
						.join("\n")
				: "";
			const canonicalReply = humanOutcomes
				? `${reply.trim()}\n\nHuman check outcomes:\n${humanOutcomes}`
				: reply.trim();
			const fingerprint = `${workspaceId(selected)}:${selected.requestId}:${requestRevision(selected)}:${action}:${canonicalReply}`;
			if (!attemptRef.current || attemptRef.current.fingerprint !== fingerprint)
				attemptRef.current = { fingerprint, key: `web:${workspaceId(selected)}:${selected.requestId}:${Date.now()}` };
			const response = await apiClient.respondWorkflow({
				requestId: selected.requestId,
				reply: canonicalReply,
				action: action === "recommendation" || action === "custom" ? "answer" : action,
				expectedRevision: requestRevision(selected) === "unknown" ? undefined : requestRevision(selected),
				idempotencyKey: attemptRef.current.key,
				workspaceId: workspaceId(selected),
			});
			if (latestScopeRef.current !== scope || selectedKeyRef.current !== key) return;
			setResult(response);
			if (!response.ok) {
				setError(response.stderr || "The answer was not accepted. The draft is preserved.");
				return;
			}
			if (response.saved !== true) {
				setError("The response command completed, but durable saving was not confirmed. The draft is preserved.");
				return;
			}
			await refreshWorkflow();
			if (latestScopeRef.current !== scope || selectedKeyRef.current !== key) return;
			localStorage.removeItem(
				`backlog.workflow.draft:${workspaceId(selected)}:${taskId(selected)}:${selected.requestId}`,
			);
			setReply("");
			setChecks({});
			setObservations({});
			const nextRequest = visible.find(
				(request) =>
					requestKey(request) !== requestKey(selected) &&
					queuedKeys.has(requestKey(request)) &&
					canRespond(request, writable, aggregate),
			);
			setQueuedKeys((current) => {
				const nextSet = new Set(current);
				nextSet.delete(requestKey(selected));
				return nextSet;
			});
			if (nextRequest) setSelectedKey(requestKey(nextRequest));
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "The answer could not be saved. The draft is preserved.");
		} finally {
			setSubmitting(false);
		}
	};

	const resume = async () => {
		if (!selected || !selectedRecoveryWritable) return;
		const key = requestKey(selected);
		try {
			const response = await apiClient.resumeWorkflow(selected.requestId, workspaceId(selected));
			if (latestScopeRef.current !== scope || selectedKeyRef.current !== key) return;
			setResult(response);
			await refreshWorkflow();
		} catch (reason) {
			if (latestScopeRef.current === scope && selectedKeyRef.current === key)
				setError(reason instanceof Error ? reason.message : "Resume failed");
		}
	};

	const cancel = async () => {
		if (!selected) return;
		const key = requestKey(selected);
		try {
			const response = await apiClient.cancelWorkflow(selected.requestId, "Cancelled by human", workspaceId(selected));
			if (latestScopeRef.current !== scope || selectedKeyRef.current !== key) return;
			setResult(response);
			await refreshWorkflow();
		} catch (reason) {
			if (latestScopeRef.current === scope && selectedKeyRef.current === key)
				setError(reason instanceof Error ? reason.message : "Cancel failed");
		}
	};

	const loadMaterial = async () => {
		if (!selected || expandedMaterial) {
			setExpandedMaterial(false);
			return;
		}
		const key = requestKey(selected);
		setExpandedMaterial(true);
		const paths = materialPaths(selected);
		if (!paths.length) return;
		try {
			const results = await Promise.all(
				paths.map((path) => apiClient.fetchWorkflowMaterial(path, workspaceId(selected))),
			);
			if (latestScopeRef.current !== scope || selectedKeyRef.current !== key) return;
			setMaterial({
				ok: results.every((item) => item.ok),
				content: results.map((item, index) => `[${paths[index]}]\n${materialText(item)}`).join("\n\n"),
			});
		} catch (reason) {
			if (latestScopeRef.current === scope && selectedKeyRef.current === key)
				setMaterial({ ok: false, stderr: reason instanceof Error ? reason.message : "Material unavailable" });
		}
	};

	return (
		<div className="page-shell space-y-4" data-testid="workflow-inbox">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Human inbox</h1>
				<button
					type="button"
					className="rounded border px-3 py-2 text-sm"
					onClick={() => {
						void refreshWorkflow(true).catch((reason) =>
							setLoadError(reason instanceof Error ? reason.message : "Workflow facts unavailable"),
						);
					}}
				>
					Refresh
				</button>
			</div>
			<div className="flex flex-wrap gap-2" role="toolbar" aria-label="Human inbox filters">
				<input
					aria-label="Search requests"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Search"
					className="rounded border px-3 py-2 text-sm"
				/>
				<select
					aria-label="Filter request type"
					value={kindFilter}
					onChange={(event) => setKindFilter(event.target.value)}
					className="rounded border px-3 py-2 text-sm"
				>
					<option value="">All request types</option>
					{["decision", "review", "acceptance", "authorization"].map((kind) => (
						<option key={kind} value={kind}>
							{kind}
						</option>
					))}
				</select>
				<select
					aria-label="Filter directory project"
					value={projectFilter}
					onChange={(event) => setProjectFilter(event.target.value)}
					className="rounded border px-3 py-2 text-sm"
				>
					<option value="">All directory projects</option>
					{projects.map((project) => (
						<option key={project} value={project}>
							{project}
						</option>
					))}
				</select>
				<span className="rounded bg-gray-100 px-2 py-2 text-sm dark:bg-gray-800">
					{visible.filter((request) => canRespond(request, writable, aggregate)).length} ready ·{" "}
					{visible.filter((request) => value(request, "status", "state").toLowerCase() === "answered").length} recovery
				</span>
			</div>
			{loadError && (
				<div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
					{loadError}
				</div>
			)}
			{result && !selected && (
				<div role="status" className="rounded border border-green-300 bg-green-50 p-3 text-sm">
					Answer saved: {result.saved === true ? "yes" : result.saved === false ? "no" : "unknown"}; transport:{" "}
					{resultFact(result, "transport")}; delivery: {resultFact(result, "delivered")}; received:{" "}
					{resultFact(result, "received")}; execution: {resultFact(result, "completed")}.
				</div>
			)}
			{snapshot?.errors?.map((item) => (
				<div
					key={`${item.workspaceId ?? "project"}:${item.error}`}
					role="alert"
					className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
				>
					{item.workspaceId ?? "project"}: {item.error}
				</div>
			))}
			{snapshot?.warnings?.map((item) => (
				<div
					key={`${item.workspaceId ?? "project"}:${item.warning}`}
					role="status"
					className="rounded border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900"
				>
					{item.workspaceId ?? "project"}: {item.warning}
				</div>
			))}
			<div className="grid gap-4 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.5fr)]">
				<div className="overflow-auto rounded border border-gray-200 dark:border-gray-700">
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="border-b bg-gray-50 dark:bg-gray-800">
								<th className="p-3">
									<input
										type="checkbox"
										aria-label="Select all writable requests"
										checked={
											visible
												.filter((request) => canRespond(request, writable, aggregate))
												.every((request) => queuedKeys.has(requestKey(request))) &&
											visible.some((request) => canRespond(request, writable, aggregate))
										}
										onChange={(event) =>
											setQueuedKeys((current) => {
												const next = new Set(current);
												visible
													.filter((request) => canRespond(request, writable, aggregate))
													.forEach((request) => {
														if (event.target.checked) next.add(requestKey(request));
														else next.delete(requestKey(request));
													});
												return next;
											})
										}
									/>
								</th>
								<th className="p-3">Request</th>
								<th className="p-3">Project</th>
								<th className="p-3">Type</th>
							</tr>
						</thead>
						<tbody>
							{visible.map((request) => (
								<tr
									key={requestKey(request)}
									className={`cursor-pointer border-b dark:border-gray-700 ${selected && requestKey(selected) === requestKey(request) ? "bg-blue-50 dark:bg-blue-950" : ""}`}
									onClick={() => setSelectedKey(requestKey(request))}
								>
									<td className="p-3">
										<input
											type="checkbox"
											aria-label={`Queue ${request.requestId} in ${workspaceId(request)}`}
											disabled={!canRespond(request, writable, aggregate)}
											checked={queuedKeys.has(requestKey(request))}
											onClick={(event) => event.stopPropagation()}
											onChange={(event) =>
												setQueuedKeys((current) => {
													const next = new Set(current);
													if (event.target.checked) next.add(requestKey(request));
													else next.delete(requestKey(request));
													return next;
												})
											}
										/>
									</td>
									<td className="p-3">
										<button type="button" className="text-left font-medium">
											{request.question || request.requestId}
										</button>
										<div className="text-xs text-gray-500">{taskId(request)}</div>
									</td>
									<td className="p-3">{workspaceId(request)}</td>
									<td className="p-3 capitalize">{requestKind(request)}</td>
								</tr>
							))}
						</tbody>
					</table>
					{visible.length === 0 && <div className="p-4 text-sm text-gray-500">No human-ready requests.</div>}
				</div>
				{selected ? (
					<section
						className="space-y-4 rounded border border-gray-200 p-4 dark:border-gray-700"
						aria-label="Request details"
					>
						<div>
							<div className="flex flex-wrap items-center gap-2">
								<h2 className="text-xl font-semibold">{requestKind(selected)}</h2>
								<span className="rounded border px-2 py-1 text-xs">{workspaceId(selected)}</span>
								<a
									className="rounded border px-2 py-1 text-xs underline"
									href={`/tasks/${encodeURIComponent(taskId(selected))}?workspace=${encodeURIComponent(workspaceId(selected))}`}
								>
									{taskId(selected)}
								</a>
							</div>
							<p className="mt-2 text-gray-800 dark:text-gray-200">{selected.question || "No question supplied."}</p>
						</div>
						<div className="grid gap-3 text-sm sm:grid-cols-3">
							<div>
								<b>Recommendation</b>
								<div>{selected.recommendation || "unknown"}</div>
							</div>
							<div>
								<b>Impact / scope</b>
								<div>{selected.impact || selected.scope || "unknown"}</div>
							</div>
							<div>
								<b>Revision</b>
								<div>{requestRevision(selected)}</div>
							</div>
						</div>
						<WorkflowFacts request={selected} result={result} />
						<SessionSummary request={selected} agents={snapshot?.agents} />
						<DetailSection title="Preconditions" items={selected.preconditions} />
						<DetailSection title="Steps" items={selected.steps} />
						<DetailSection title="Expected" items={selected.expectations} />
						{requestKind(selected) === "review" && (
							<DetailSection
								title="Evidence"
								items={
									Array.isArray(selected.evidence)
										? selected.evidence.map((item) => item.label || item.name || item.value || item.result || "unknown")
										: Object.entries(machineEvidence(selected)).map(([key, item]) => `${key}: ${String(item)}`)
								}
							/>
						)}
						{requestKind(selected) === "authorization" && (
							<div className="grid gap-2 text-sm sm:grid-cols-3">
								<div>
									<b>Action</b>
									<div>{selected.action || "unknown"}</div>
								</div>
								<div>
									<b>Environment</b>
									<div>{selected.environment || "unknown"}</div>
								</div>
								<div>
									<b>Deadline</b>
									<div>{selected.deadline || "unknown"}</div>
								</div>
							</div>
						)}
						{revisionNotice && (
							<div role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
								{revisionNotice}
							</div>
						)}
						{materialPaths(selected).length ? (
							<div>
								<button type="button" className="text-sm font-medium underline" onClick={() => void loadMaterial()}>
									{expandedMaterial ? "Hide material" : "Show material"}
								</button>
								{expandedMaterial && (
									<pre className="mt-2 max-h-64 overflow-auto rounded bg-gray-50 p-3 text-xs dark:bg-gray-900">
										{materialText(material)}
									</pre>
								)}
							</div>
						) : null}
						{(selected.materialMissing || selected.material_missing) && (
							<div role="status" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
								Materials missing; this request is not actionable.
							</div>
						)}
						{Array.isArray(selected.approve_blockers) && selected.approve_blockers.length > 0 && (
							<div role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
								Approval blocked: {selected.approve_blockers.join("; ")}
							</div>
						)}
						<div className="space-y-2">
							<label className="block text-sm font-semibold" htmlFor="workflow-reply">
								Reply
							</label>
							<textarea
								id="workflow-reply"
								value={reply}
								onChange={(event) => setReply(event.target.value)}
								rows={5}
								className="w-full rounded border p-3 text-sm"
								placeholder="Write the human response"
							/>
						</div>
						<div className="flex flex-wrap gap-2">
							{actionsFor(selected).map((option) => (
								<button
									key={option}
									type="button"
									className={`rounded border px-3 py-2 text-sm ${action === option ? "bg-blue-100" : ""}`}
									onClick={() => {
										setAction(option);
										if (option === "recommendation" && selected.recommendation) setReply(selected.recommendation);
										if (option === "custom") setReply("");
									}}
								>
									{option}
								</button>
							))}
						</div>
						<WorkflowRequestChecks
							assertions={selected.assertions}
							evidence={machineEvidence(selected)}
							manualCases={checklist.map((item, index) => ({
								...item,
								id: caseKey(item, index),
								assertion: item.assertion || item.label || item.text || `Check ${index + 1}`,
								pre: item.pre ? `pre: ${item.pre}` : item.pre,
								actual: item.actual ? `actual: ${item.actual}` : item.actual,
							}))}
							checks={checks}
							observations={observations}
							onCheckChange={(id, checked) => setChecks((current) => ({ ...current, [id]: checked }))}
							onObservationChange={(id, text) => setObservations((current) => ({ ...current, [id]: text }))}
							disabled={!selectedWritable || submitting}
						/>
						{selectedState === "answered" && (
							<div role="status" className="text-sm text-gray-600 dark:text-gray-300">
								Already answered; delivery is {deliveryState(selected) || "unknown"}. Resume the bound session to
								continue recovery.
							</div>
						)}
						{selectedState !== "answered" &&
							selected.materialMissing !== true &&
							selected.material_missing !== true &&
							actionsFor(selected).length === 0 && (
								<div role="status" className="text-sm text-gray-600 dark:text-gray-300">
									No response action is available.
								</div>
							)}
						{!selectedWritable &&
							selectedState !== "answered" &&
							(selected.materialMissing || selected.material_missing) !== true &&
							actionsFor(selected).length > 0 && (
								<div role="status" className="text-sm text-gray-600 dark:text-gray-300">
									This request is read-only or its project is unavailable.
								</div>
							)}
						{error && (
							<div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
								{error}
							</div>
						)}
						{result && (
							<div
								role="status"
								className={`rounded border p-3 text-sm ${result.ok ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"}`}
							>
								Answer saved: {result.saved === true ? "yes" : result.saved === false ? "no" : "unknown"}; transport:{" "}
								{resultFact(result, "transport")}; delivery: {resultFact(result, "delivered")}; delivery at:{" "}
								{resultFact(result, "delivery_at")}; received: {resultFact(result, "received")}; execution:{" "}
								{resultFact(result, "completed")}.{" "}
							</div>
						)}
						<button
							type="button"
							disabled={
								!selectedWritable || !reply.trim() || (requiresChecks && (!allChecked || hasObservations)) || submitting
							}
							onClick={() => void submit()}
							className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
						>
							{submitting ? "Saving…" : "Save answer"}
						</button>
						{result && !result.ok && (
							<button
								type="button"
								disabled={submitting}
								onClick={() => void submit()}
								className="ml-2 rounded border px-4 py-2 text-sm"
							>
								Retry save
							</button>
						)}
						{result && !result.ok && selectedRecoveryWritable && (
							<button type="button" onClick={() => void resume()} className="ml-2 rounded border px-4 py-2 text-sm">
								Resume bound session
							</button>
						)}
						{selectedState === "answered" && selectedRecoveryWritable && (
							<button type="button" onClick={() => void resume()} className="ml-2 rounded border px-4 py-2 text-sm">
								Resume bound session
							</button>
						)}
						{selectedWritable && (
							<button type="button" onClick={() => void cancel()} className="ml-2 rounded border px-4 py-2 text-sm">
								Cancel request
							</button>
						)}
					</section>
				) : (
					<div className="rounded border p-4 text-sm text-gray-500">Select a request.</div>
				)}
			</div>
		</div>
	);
}
