import type { DuplicateRepairPlan, DuplicateRepairResult } from "../../core/duplicate-task-repair.ts";
import type { TaskStatistics } from "../../core/statistics.ts";
import type { TaskDetail } from "../../core/task-detail.ts";
import type {
	BacklogConfig,
	Decision,
	Document,
	Milestone,
	SearchPriorityFilter,
	SearchResult,
	SearchResultType,
	Task,
	TaskStatus,
} from "../../types/index.ts";

const API_BASE = "/api";

export interface WorkspaceSummary {
	id: string;
	name: string;
	rootPath: string;
	writable: boolean;
	error?: string;
}

export interface WorkspaceTasksResponse {
	tasks: Array<Task & { workspaceId: string }>;
	errors: Array<{ workspaceId: string; error: string }>;
}

export type WorkflowRequestKind = "decision" | "review" | "acceptance" | "authorization" | string;

export interface WorkflowRequest {
	requestId: string;
	kind: WorkflowRequestKind;
	question?: string;
	recommendation?: string;
	impact?: string;
	scope?: string;
	workspaceId?: string;
	taskId?: string;
	ticket?: string;
	status?: string;
	state?: string;
	actionable?: boolean;
	currentRevision?: string | number;
	current_revision?: string | number;
	revision?: string | number;
	decisionId?: string;
	questionId?: string;
	assertions?: Array<{ id?: string; text?: string; result?: string }>;
	evidence?:
		| Array<{ label?: string; name?: string; value?: string; result?: string; passed?: boolean }>
		| Record<string, unknown>;
	transport?: string;
	delivery?: string | { status?: string; state?: string };
	delivery_at?: string;
	deliveryAt?: string;
	answered_at?: string;
	checklist?: Array<{
		id?: string;
		label?: string;
		text?: string;
		assertion?: string;
		pre?: string;
		step?: string;
		op?: string;
		expect?: string;
		actual?: string;
		checked?: boolean;
	}>;
	entry?: string;
	preconditions?: string[];
	steps?: string[];
	expectations?: string[];
	action?: string;
	actions?: string[];
	manual_cases?: Array<{
		id?: string;
		label?: string;
		text?: string;
		assertion?: string;
		pre?: string;
		step?: string;
		op?: string;
		expect?: string;
		actual?: string;
		checked?: boolean;
	}>;
	material_missing?: boolean;
	environment?: string;
	deadline?: string;
	materials?: string[];
	materialMissing?: boolean;
	materialError?: string;
	[key: string]: unknown;
}

export interface WorkflowSnapshot {
	requests?: WorkflowRequest[];
	tasks?: Array<Record<string, unknown>>;
	review_items?: Array<Record<string, unknown>>;
	reviewItems?: Array<Record<string, unknown>>;
	agents?:
		| { source?: string; available?: boolean; collected_at?: string; items?: Array<Record<string, unknown>> }
		| Array<Record<string, unknown>>;
	errors?: Array<{ workspaceId?: string; error: string }>;
	warnings?: Array<{ workspaceId?: string; warning: string }>;
	[key: string]: unknown;
}

export interface WorkflowResult {
	ok: boolean;
	exitCode?: number;
	data?: unknown;
	stdout?: string;
	stderr?: string;
	saved?: boolean;
	projectionPending?: boolean;
	content?: string;
	transport?: string;
	delivery?: string | { status?: string; state?: string };
	delivery_at?: string;
	deliveryAt?: string;
}

export interface ReorderTaskPayload {
	taskId: string;
	targetStatus: string;
	orderedTaskIds: string[];
	targetMilestone?: string | null;
	workspaceId?: string;
}

export interface MoveTasksPayload {
	taskIds: string[];
	targetStatus: string;
	targetMilestone?: string | null;
}

export interface MoveTasksResult {
	success: boolean;
	tasks: Task[];
	changedTasks: Task[];
	failures: Array<{ taskId: string; reason: string }>;
}

/**
 * Read the marker the server forwards when a mutation failed after the record had already moved.
 * The view converges on what happened instead of offering a retry of a move that already ran.
 */
function readMovedFailureData(error: unknown): Record<string, unknown> | null {
	if (
		!(error instanceof ApiError) ||
		error.status === undefined ||
		error.status < 500 ||
		typeof error.data !== "object" ||
		error.data === null
	) {
		return null;
	}
	return error.data as Record<string, unknown>;
}

export function readMovedFailureState(
	error: unknown,
	key: "archiveState" | "demotionState",
): "moved" | "partial" | null {
	const state = readMovedFailureData(error)?.[key];
	return state === "moved" || state === "partial" ? state : null;
}

export function readDemotionFailureCause(error: unknown): "cleanup" | "commit" | null {
	const cause = readMovedFailureData(error)?.demotionFailureCause;
	return cause === "cleanup" || cause === "commit" ? cause : null;
}

/** Demoting vacates a task ID: `cleanedTaskIds` names the records that lost a reference to it. */
export interface TaskVacancyResponse {
	success: boolean;
	cleanedTaskIds: string[];
}

export type TaskUpdateRequest = Omit<Partial<Task>, "milestone" | "dueDate" | "project"> & {
	milestone?: string | null;
	dueDate?: string | null;
	project?: string | null;
	commentsAppend?: string[];
	commentAuthor?: string;
};

export interface InitializationStatus {
	initialized: boolean;
	projectPath: string;
	backlogDirectory?: string | null;
	backlogDirectorySource?: "backlog" | ".backlog" | "custom" | null;
	configLocation?: "folder" | "root" | null;
	rootConfigPath?: string | null;
}

// Enhanced error types for better error handling
export class ApiError extends Error {
	constructor(
		message: string,
		public status?: number,
		public code?: string,
		public data?: unknown,
	) {
		super(message);
		this.name = "ApiError";
	}

	static fromResponse(response: Response, data?: unknown): ApiError {
		const errorMessage =
			typeof data === "object" && data !== null && "error" in data ? (data as { error?: unknown }).error : undefined;
		const message =
			typeof errorMessage === "string" && errorMessage.trim().length > 0
				? errorMessage
				: `HTTP ${response.status}: ${response.statusText}`;
		return new ApiError(message, response.status, response.statusText, data);
	}
}

export class NetworkError extends Error {
	constructor(message = "Network request failed") {
		super(message);
		this.name = "NetworkError";
	}
}

/** Builds an ApiError that keeps the server's message when the response body carries one. */
async function toApiError(response: Response, fallbackMessage: string): Promise<ApiError> {
	const data = await response.json().catch(() => undefined);
	const serverMessage = typeof data === "object" && data !== null ? (data as { error?: unknown }).error : undefined;
	const message =
		typeof serverMessage === "string" && serverMessage.trim().length > 0 ? serverMessage : fallbackMessage;
	return new ApiError(message, response.status, response.statusText, data);
}

/** The document and decision endpoints answer 409 only when an ID matches more than one file. */
export function isAmbiguousIdConflict(error: unknown): error is ApiError {
	return error instanceof ApiError && error.status === 409;
}

// Request configuration interface
interface RequestConfig {
	retries?: number;
	timeout?: number;
	Headers?: Record<string, string>;
}

// Default configuration
const DEFAULT_CONFIG: RequestConfig = {
	retries: 3,
	timeout: 10000,
};

export class ApiClient {
	private config: RequestConfig;

	constructor(config: RequestConfig = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	// Enhanced fetch with retry logic and better error handling
	private async fetchWithRetry(url: string, options: RequestInit = {}, retriesOverride?: number): Promise<Response> {
		const { retries: configuredRetries = 3, timeout = 10000 } = this.config;
		const retries = retriesOverride ?? configuredRetries;
		let lastError: Error | undefined;

		for (let attempt = 0; attempt <= retries; attempt++) {
			try {
				// Add timeout to the request
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), timeout);

				const requestUrl = typeof window === "undefined" ? url : this.withWorkspaceScope(url, options);
				const response = await fetch(requestUrl, {
					...options,
					signal: controller.signal,
					headers: {
						"Content-Type": "application/json",
						...options.headers,
					},
				});

				clearTimeout(timeoutId);

				if (!response.ok) {
					let errorData: unknown = null;
					try {
						errorData = await response.json();
					} catch {
						// Ignore JSON parse errors for error data
					}
					throw ApiError.fromResponse(response, errorData);
				}

				return response;
			} catch (error) {
				lastError = error as Error;

				// Don't retry on client errors (4xx) or specific cases
				if (error instanceof ApiError && error.status && error.status >= 400 && error.status < 500) {
					throw error;
				}

				// For network errors or server errors, retry with exponential backoff
				if (attempt < retries) {
					const delay = Math.min(1000 * 2 ** attempt, 10000);
					await new Promise((resolve) => setTimeout(resolve, delay));
				}
			}
		}

		// If we get here, all retries failed
		if (lastError instanceof ApiError) {
			throw lastError;
		}
		throw new NetworkError(`Request failed after ${retries + 1} attempts: ${lastError?.message}`);
	}

	private withWorkspaceScope(url: string, options: RequestInit = {}): string {
		const scope = new URLSearchParams(window.location.search).get("workspace");
		const params = new URLSearchParams(window.location.search);
		const target = params.get("taskWorkspace");
		if (target && options.method && options.method !== "GET" && url.includes("/tasks")) {
			if (!url.includes("workspace="))
				return `${url}${url.includes("?") ? "&" : "?"}workspace=${encodeURIComponent(target)}`;
		}
		if (!scope || url.includes("workspace=") || url.includes("allWorkspaces=")) return url;
		const separator = url.includes("?") ? "&" : "?";
		return scope === "all"
			? `${url}${separator}allWorkspaces=true`
			: `${url}${separator}workspace=${encodeURIComponent(scope)}`;
	}

	private async fetchWithoutRetry(url: string, options: RequestInit = {}): Promise<Response> {
		return await this.fetchWithRetry(url, options, 0);
	}

	// Helper method for JSON responses
	private async fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
		const response = await this.fetchWithRetry(url, options);
		return response.json();
	}
	async fetchTasks(options?: {
		status?: string;
		excludeStatus?: string | string[];
		assignee?: string;
		parent?: string;
		priority?: SearchPriorityFilter;
		labels?: string[];
		crossBranch?: boolean;
	}): Promise<Task[]> {
		const params = new URLSearchParams();
		if (options?.status) params.append("status", options.status);
		if (options?.excludeStatus) {
			const statuses = Array.isArray(options.excludeStatus) ? options.excludeStatus : [options.excludeStatus];
			for (const status of statuses) {
				if (status && status.trim().length > 0) {
					params.append("excludeStatus", status.trim());
				}
			}
		}
		if (options?.assignee) params.append("assignee", options.assignee);
		if (options?.parent) params.append("parent", options.parent);
		if (options?.priority) params.append("priority", options.priority);
		if (options?.labels) {
			for (const label of options.labels) {
				if (label && label.trim().length > 0) {
					params.append("label", label.trim());
				}
			}
		}
		// Default to true for cross-branch loading to match TUI behavior
		if (options?.crossBranch !== false) params.append("crossBranch", "true");

		const url = `${API_BASE}/tasks${params.toString() ? `?${params.toString()}` : ""}`;
		return this.fetchJson<Task[]>(url);
	}

	async search(
		options: {
			query?: string;
			types?: SearchResultType[];
			status?: string | string[];
			excludeStatus?: string | string[];
			priority?: SearchPriorityFilter | SearchPriorityFilter[];
			assignee?: string | string[];
			labels?: string[];
			modifiedFiles?: string[];
			limit?: number;
		} = {},
	): Promise<SearchResult[]> {
		const params = new URLSearchParams();
		if (options.query) {
			params.set("query", options.query);
		}
		if (options.types && options.types.length > 0) {
			for (const type of options.types) {
				params.append("type", type);
			}
		}
		if (options.status) {
			const statuses = Array.isArray(options.status) ? options.status : [options.status];
			for (const status of statuses) {
				params.append("status", status);
			}
		}
		if (options.excludeStatus) {
			const statuses = Array.isArray(options.excludeStatus) ? options.excludeStatus : [options.excludeStatus];
			for (const status of statuses) {
				if (status && status.trim().length > 0) {
					params.append("excludeStatus", status.trim());
				}
			}
		}
		if (options.priority) {
			const priorities = Array.isArray(options.priority) ? options.priority : [options.priority];
			for (const priority of priorities) {
				params.append("priority", priority);
			}
		}
		if (options.assignee) {
			const assignees = Array.isArray(options.assignee) ? options.assignee : [options.assignee];
			for (const assignee of assignees) {
				if (assignee && assignee.trim().length > 0) {
					params.append("assignee", assignee.trim());
				}
			}
		}
		if (options.labels) {
			for (const label of options.labels) {
				if (label && label.trim().length > 0) {
					params.append("label", label.trim());
				}
			}
		}
		if (options.modifiedFiles) {
			for (const file of options.modifiedFiles) {
				if (file && file.trim().length > 0) {
					params.append("modifiedFile", file.trim());
				}
			}
		}
		if (options.limit !== undefined) {
			params.set("limit", String(options.limit));
		}

		const url = `${API_BASE}/search${params.toString() ? `?${params.toString()}` : ""}`;
		return this.fetchJson<SearchResult[]>(url);
	}

	/** Reads one task through the detail path, so the response already carries its dependency graph. */
	async fetchTask(id: string, workspaceId?: string): Promise<TaskDetail> {
		const target = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : "";
		return this.fetchJson<TaskDetail>(`${API_BASE}/task/${encodeURIComponent(id)}${target}`);
	}

	async createTask(task: Omit<Task, "id" | "createdDate">, workspaceId?: string): Promise<Task> {
		const target = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : "";
		return this.fetchJson<Task>(`${API_BASE}/tasks${target}`, {
			method: "POST",
			body: JSON.stringify(workspaceId ? { ...task, workspaceId } : task),
		});
	}

	async updateTask(id: string, updates: TaskUpdateRequest, workspaceId?: string): Promise<Task> {
		const taskWorkspace =
			workspaceId ??
			(typeof window === "undefined" ? undefined : new URLSearchParams(window.location.search).get("taskWorkspace"));
		const target = taskWorkspace ? `?workspace=${encodeURIComponent(taskWorkspace)}` : "";
		return this.fetchJson<Task>(`${API_BASE}/tasks/${id}${target}`, {
			method: "PUT",
			body: JSON.stringify(taskWorkspace ? { ...updates, workspaceId: taskWorkspace } : updates),
		});
	}

	async reorderTask(
		payload: ReorderTaskPayload,
		workspaceId?: string,
	): Promise<{ success: boolean; task: Task; changedTasks: Task[] }> {
		const target = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : "";
		return this.fetchJson<{ success: boolean; task: Task; changedTasks: Task[] }>(
			`${API_BASE}/tasks/reorder${target}`,
			{
				method: "POST",
				body: JSON.stringify(payload),
			},
		);
	}

	async moveTasks(payload: MoveTasksPayload, workspaceId?: string): Promise<MoveTasksResult> {
		const target = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : "";
		return this.fetchJson<MoveTasksResult>(`${API_BASE}/tasks/move${target}`, {
			method: "POST",
			body: JSON.stringify(payload),
		});
	}

	// Not retried, for the same reason demote is not: the second attempt would target a task the
	// first attempt already archived, and its "not found" would replace the real outcome.
	async archiveTask(id: string): Promise<void> {
		await this.fetchWithoutRetry(`${API_BASE}/tasks/${encodeURIComponent(id)}/archive`, {
			method: "POST",
		});
	}

	async demoteTask(id: string): Promise<TaskVacancyResponse> {
		const response = await this.fetchWithoutRetry(`${API_BASE}/tasks/${encodeURIComponent(id)}/demote`, {
			method: "POST",
		});
		return response.json();
	}

	async getCleanupPreview(age: number): Promise<{
		count: number;
		tasks: Array<{ id: string; title: string; updatedDate?: string; createdDate: string }>;
	}> {
		return this.fetchJson<{
			count: number;
			tasks: Array<{ id: string; title: string; updatedDate?: string; createdDate: string }>;
		}>(`${API_BASE}/tasks/cleanup?age=${age}`);
	}

	/**
	 * Archive the tasks a cleanup preview showed, and only those. The server skips a task that has left
	 * the board or the final status since the preview.
	 */
	async executeCleanup(
		taskIds: string[],
	): Promise<{ success: boolean; movedCount: number; totalCount: number; message: string; failedTasks?: string[] }> {
		return this.fetchJson<{
			success: boolean;
			movedCount: number;
			totalCount: number;
			message: string;
			failedTasks?: string[];
		}>(`${API_BASE}/tasks/cleanup/execute`, {
			method: "POST",
			body: JSON.stringify({ taskIds }),
		});
	}

	async updateTaskStatus(id: string, status: TaskStatus): Promise<Task> {
		return this.updateTask(id, { status });
	}

	async fetchDuplicateTaskRepairPlan(): Promise<DuplicateRepairPlan> {
		return await this.fetchJson<DuplicateRepairPlan>(`${API_BASE}/tasks/duplicates`);
	}

	async repairDuplicateTaskIds(fingerprint: string): Promise<DuplicateRepairResult> {
		return await this.fetchJson<DuplicateRepairResult>(`${API_BASE}/tasks/duplicates`, {
			method: "POST",
			body: JSON.stringify({ fingerprint }),
		});
	}

	async fetchStatuses(): Promise<string[]> {
		const response = await this.fetchWithRetry(`${API_BASE}/statuses`);
		if (!response.ok) {
			throw new Error("Failed to fetch statuses");
		}
		return response.json();
	}

	async fetchConfig(): Promise<BacklogConfig> {
		const response = await this.fetchWithRetry(`${API_BASE}/config`);
		if (!response.ok) {
			throw new Error("Failed to fetch config");
		}
		return response.json();
	}

	async updateConfig(config: BacklogConfig): Promise<BacklogConfig> {
		const response = await this.fetchWithRetry(`${API_BASE}/config`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(config),
		});
		if (!response.ok) {
			throw new Error("Failed to update config");
		}
		return response.json();
	}

	async fetchWorkspaces(): Promise<WorkspaceSummary[]> {
		return this.fetchJson<WorkspaceSummary[]>(`${API_BASE}/workspaces`);
	}

	async fetchWorkspaceTasks(): Promise<WorkspaceTasksResponse> {
		return this.fetchJson<WorkspaceTasksResponse>(`${API_BASE}/workspaces/tasks?allWorkspaces=true`);
	}

	async fetchWorkflow(workspaceId?: string, refresh = false): Promise<WorkflowSnapshot> {
		const params = new URLSearchParams();
		if (workspaceId === "all") params.set("allWorkspaces", "true");
		else if (workspaceId) params.set("workspace", workspaceId);
		if (refresh) params.set("refresh", "true");
		const target = params.toString() ? `?${params.toString()}` : "";
		const raw = await this.fetchJson<WorkflowSnapshot | { ok: boolean; data?: WorkflowSnapshot; error?: string }>(
			`${API_BASE}/workflow${target}`,
		);
		if (typeof raw === "object" && raw !== null && "ok" in raw && typeof raw.ok === "boolean" && !Array.isArray(raw)) {
			const envelope = raw as { ok: boolean; data?: WorkflowSnapshot; error?: unknown };
			if (envelope.ok && envelope.data) return envelope.data;
			if (!envelope.ok)
				return {
					requests: [],
					tasks: [],
					review_items: [],
					agents: [],
					errors: [{ error: typeof envelope.error === "string" ? envelope.error : "Workflow unavailable" }],
				};
		}
		return raw as WorkflowSnapshot;
	}

	async respondWorkflow(input: {
		requestId: string;
		reply: string;
		action?: string;
		expectedRevision?: string | number;
		idempotencyKey: string;
		by?: string;
		workspaceId?: string;
	}): Promise<WorkflowResult> {
		const target = input.workspaceId ? `?workspace=${encodeURIComponent(input.workspaceId)}` : "";
		return this.fetchJson<WorkflowResult>(`${API_BASE}/workflow/respond${target}`, {
			method: "POST",
			body: JSON.stringify(input),
		});
	}

	async cancelWorkflow(requestId: string, reason: string, workspaceId?: string): Promise<WorkflowResult> {
		const target = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : "";
		return this.fetchJson<WorkflowResult>(`${API_BASE}/workflow/cancel${target}`, {
			method: "POST",
			body: JSON.stringify({ requestId, reason }),
		});
	}

	async resumeWorkflow(requestId: string, workspaceId?: string): Promise<WorkflowResult> {
		const target = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : "";
		return this.fetchJson<WorkflowResult>(`${API_BASE}/workflow/resume${target}`, {
			method: "POST",
			body: JSON.stringify({ requestId }),
		});
	}

	async fetchWorkflowMaterial(path: string, workspaceId?: string): Promise<WorkflowResult> {
		const params = new URLSearchParams({ path });
		if (workspaceId) params.set("workspace", workspaceId);
		return this.fetchJson<WorkflowResult>(`${API_BASE}/workflow/material?${params.toString()}`);
	}

	async fetchDocs(): Promise<Document[]> {
		const response = await this.fetchWithRetry(`${API_BASE}/docs`);
		if (!response.ok) {
			throw new Error("Failed to fetch documentation");
		}
		return response.json();
	}

	async fetchDoc(filename: string): Promise<Document> {
		const response = await this.fetchWithRetry(`${API_BASE}/docs/${encodeURIComponent(filename)}`);
		if (!response.ok) {
			throw await toApiError(response, "Failed to fetch document");
		}
		return response.json();
	}

	async fetchDocument(id: string): Promise<Document> {
		const response = await this.fetchWithRetry(`${API_BASE}/doc/${encodeURIComponent(id)}`);
		if (!response.ok) {
			throw await toApiError(response, "Failed to fetch document");
		}
		return response.json();
	}

	async updateDoc(filename: string, content: string, title?: string, path?: string | null): Promise<Document> {
		const payload: Record<string, unknown> = { content };
		if (typeof title === "string") {
			payload.title = title;
		}
		if (path !== undefined) {
			payload.path = path;
		}

		const response = await this.fetchWithRetry(`${API_BASE}/docs/${encodeURIComponent(filename)}`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
		});
		if (!response.ok) {
			throw await toApiError(response, "Failed to update document");
		}
		return response.json();
	}

	async createDoc(filename: string, content: string, path?: string): Promise<Document & { success?: boolean }> {
		const response = await this.fetchWithRetry(`${API_BASE}/docs`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ filename, content, path }),
		});
		if (!response.ok) {
			throw new Error("Failed to create document");
		}
		return response.json();
	}

	// Archive is not retried, for the reason task archive is not: the second attempt would target a
	// record the first attempt already archived, and its refusal would replace the real outcome.
	async archiveDoc(id: string): Promise<void> {
		await this.fetchWithoutRetry(`${API_BASE}/docs/${encodeURIComponent(id)}/archive`, { method: "POST" });
	}

	async archiveDecision(id: string): Promise<void> {
		await this.fetchWithoutRetry(`${API_BASE}/decisions/${encodeURIComponent(id)}/archive`, { method: "POST" });
	}

	async fetchDecisions(): Promise<Decision[]> {
		const response = await this.fetchWithRetry(`${API_BASE}/decisions`);
		if (!response.ok) {
			throw new Error("Failed to fetch decisions");
		}
		return response.json();
	}

	async fetchDecision(id: string): Promise<Decision> {
		const response = await this.fetchWithRetry(`${API_BASE}/decisions/${encodeURIComponent(id)}`);
		if (!response.ok) {
			throw await toApiError(response, "Failed to fetch decision");
		}
		return response.json();
	}

	async fetchDecisionData(id: string): Promise<Decision> {
		const response = await this.fetchWithRetry(`${API_BASE}/decision/${encodeURIComponent(id)}`);
		if (!response.ok) {
			throw await toApiError(response, "Failed to fetch decision");
		}
		return response.json();
	}

	async updateDecision(id: string, content: string): Promise<void> {
		const response = await this.fetchWithRetry(`${API_BASE}/decisions/${encodeURIComponent(id)}`, {
			method: "PUT",
			headers: {
				"Content-Type": "text/plain",
			},
			body: content,
		});
		if (!response.ok) {
			throw await toApiError(response, "Failed to update decision");
		}
	}

	async createDecision(title: string): Promise<Decision> {
		const response = await this.fetchWithRetry(`${API_BASE}/decisions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ title }),
		});
		if (!response.ok) {
			throw new Error("Failed to create decision");
		}
		return response.json();
	}

	async fetchMilestones(): Promise<Milestone[]> {
		const response = await this.fetchWithRetry(`${API_BASE}/milestones`);
		if (!response.ok) {
			throw new Error("Failed to fetch milestones");
		}
		return response.json();
	}

	async fetchArchivedMilestones(): Promise<Milestone[]> {
		const response = await this.fetchWithRetry(`${API_BASE}/milestones/archived`);
		if (!response.ok) {
			throw new Error("Failed to fetch archived milestones");
		}
		return response.json();
	}

	async fetchMilestone(id: string): Promise<Milestone> {
		const response = await this.fetchWithRetry(`${API_BASE}/milestones/${encodeURIComponent(id)}`);
		if (!response.ok) {
			throw new Error("Failed to fetch milestone");
		}
		return response.json();
	}

	async createMilestone(title: string, description?: string, dueDate?: string): Promise<Milestone> {
		const response = await this.fetchWithRetry(`${API_BASE}/milestones`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ title, description, dueDate }),
		});
		if (!response.ok) {
			const data = await response.json().catch(() => ({}));
			throw new Error(data.error || "Failed to create milestone");
		}
		return response.json();
	}

	async updateMilestone(
		id: string,
		title: string,
		dueDate?: string | null,
	): Promise<{ success: boolean; milestone?: Milestone | null; message?: string }> {
		const response = await this.fetchWithRetry(`${API_BASE}/milestones/${encodeURIComponent(id)}`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ title, dueDate }),
		});
		if (!response.ok) {
			const data = await response.json().catch(() => ({}));
			throw new Error(data.error || "Failed to update milestone");
		}
		return response.json();
	}

	async removeMilestone(
		id: string,
		options: { taskHandling?: "clear" | "keep" | "reassign"; reassignTo?: string } = {},
	): Promise<{ success: boolean; message?: string }> {
		const response = await this.fetchWithRetry(`${API_BASE}/milestones/${encodeURIComponent(id)}`, {
			method: "DELETE",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(options),
		});
		if (!response.ok) {
			const data = await response.json().catch(() => ({}));
			throw new Error(data.error || "Failed to remove milestone");
		}
		return response.json();
	}

	async archiveMilestone(id: string): Promise<{ success: boolean; milestone?: Milestone | null }> {
		const response = await this.fetchWithRetry(`${API_BASE}/milestones/${encodeURIComponent(id)}/archive`, {
			method: "POST",
		});
		if (!response.ok) {
			const data = await response.json().catch(() => ({}));
			throw new Error(data.error || "Failed to archive milestone");
		}
		return response.json();
	}

	async fetchStatistics(): Promise<
		TaskStatistics & { statusCounts: Record<string, number>; priorityCounts: Record<string, number> }
	> {
		return this.fetchJson<
			TaskStatistics & { statusCounts: Record<string, number>; priorityCounts: Record<string, number> }
		>(`${API_BASE}/statistics`);
	}

	async checkStatus(): Promise<InitializationStatus> {
		return this.fetchJson<InitializationStatus>(`${API_BASE}/status`);
	}

	async initializeProject(options: {
		projectName: string;
		backlogDirectory?: string;
		backlogDirectorySource?: "backlog" | ".backlog" | "custom";
		configLocation?: "folder" | "root";
		integrationMode: "mcp" | "cli" | "none";
		mcpClients?: ("claude" | "codex" | "gemini" | "kiro" | "guide")[];
		agentInstructions?: ("CLAUDE.md" | "AGENTS.md" | "GEMINI.md" | ".github/copilot-instructions.md")[];
		installClaudeAgent?: boolean;
		filesystemOnly?: boolean;
		advancedConfig?: {
			checkActiveBranches?: boolean;
			remoteOperations?: boolean;
			activeBranchDays?: number;
			bypassGitHooks?: boolean;
			autoCommit?: boolean;
			zeroPaddedIds?: number;
			taskPrefix?: string;
			defaultEditor?: string;
			defaultPort?: number;
			autoOpenBrowser?: boolean;
		};
	}): Promise<{ success: boolean; projectName: string; mcpResults?: Record<string, string> }> {
		return this.fetchJson<{ success: boolean; projectName: string; mcpResults?: Record<string, string> }>(
			`${API_BASE}/init`,
			{
				method: "POST",
				body: JSON.stringify(options),
			},
		);
	}
}

export const apiClient = new ApiClient();
