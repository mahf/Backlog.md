import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import WorkflowInbox from "../web/components/WorkflowInbox.tsx";
import WorkflowTaskFacts from "../web/components/WorkflowTaskFacts.tsx";
import { apiClient } from "../web/lib/api.ts";

let root: Root | null = null;
let dom: JSDOM | null = null;
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalLocalStorage = globalThis.localStorage;

afterEach(async () => {
	await act(async () => root?.unmount());
	dom?.window.close();
	root = null;
	dom = null;
	globalThis.fetch = originalFetch;
	globalThis.window = originalWindow;
	globalThis.document = originalDocument;
	globalThis.localStorage = originalLocalStorage;
});

function setup(snapshot: unknown, url = "http://localhost/?workspace=alpha") {
	dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url });
	globalThis.window = dom.window as unknown as Window & typeof globalThis;
	globalThis.document = dom.window.document;
	globalThis.localStorage = dom.window.localStorage;
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.fetch = (async (_input: RequestInfo | URL, options?: RequestInit) => {
		if (options?.method === "POST") {
			return new Response(JSON.stringify({ ok: false, stderr: "stale revision" }), { status: 200 });
		}
		if (String(_input).includes("/material"))
			return new Response(JSON.stringify({ ok: true, data: { content: "real material content" } }), { status: 200 });
		return new Response(JSON.stringify(snapshot), { status: 200, headers: { "Content-Type": "application/json" } });
	}) as typeof fetch;
}

async function render(snapshot: unknown, url?: string) {
	setup(snapshot, url);
	root = createRoot(document.getElementById("root")!);
	await act(async () => {
		root?.render(
			<MemoryRouter
				initialEntries={[
					new URL(url ?? "http://localhost/?workspace=alpha").pathname +
						new URL(url ?? "http://localhost/?workspace=alpha").search,
				]}
			>
				<WorkflowInbox
					workspaces={[
						{ id: "alpha", name: "Alpha", writable: true },
						{ id: "beta", name: "Beta", writable: false },
					]}
				/>
			</MemoryRouter>,
		);
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
}

const request = (workspaceId: string, kind: string, id = "same") => ({
	requestId: id,
	kind,
	workspaceId,
	taskId: "BACK-1",
	question: `${kind} question ${workspaceId}`,
	recommendation: "Use the documented path",
	impact: "production",
	currentRevision: "7",
	checklist: [{ label: "Human check" }],
	preconditions: ["Ready"],
	steps: ["Run it"],
	expectations: ["It works"],
	action: "deploy",
	environment: "production",
	deadline: "tomorrow",
	evidence: [{ label: "Automated check", result: "PASS" }],
});

describe("WorkflowInbox", () => {
	it("renders four request kinds, keeps duplicate IDs distinct, and gates save on checks", async () => {
		await render({
			requests: [
				request("alpha", "decision"),
				request("beta", "review"),
				request("alpha", "acceptance", "other"),
				request("alpha", "authorization", "auth"),
			],
		});
		expect(document.body.textContent).toContain("decision question alpha");
		expect(document.body.textContent).toContain("review question beta");
		expect(document.body.textContent).toContain("Human check");
		const reviewRow = Array.from(document.querySelectorAll("tbody tr")).find((row) =>
			row.textContent?.includes("review question beta"),
		) as HTMLElement;
		await act(async () => reviewRow.click());
		expect(document.body.textContent).toContain("Evidence");
		const save = Array.from(document.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Save answer"),
		) as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		const checkbox = document
			.querySelectorAll("input[type=checkbox]")
			.item(document.querySelectorAll("input[type=checkbox]").length - 1) as HTMLInputElement;
		await act(async () => {
			checkbox.click();
		});
		expect(document.querySelector("textarea")?.getAttribute("aria-label") ?? "").toBe("");
		expect(document.querySelector("textarea")).not.toBeNull();
	});

	it("makes aggregate requests read-only and preserves draft after a failed save", async () => {
		await render({ requests: [request("beta", "decision")] }, "http://localhost/?workspace=all");
		const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
		await act(async () => {
			textarea.value = "Keep this answer";
			textarea.dispatchEvent(new dom!.window.Event("input", { bubbles: true }));
		});
		expect(document.body.textContent).toContain("read-only");
		const save = Array.from(document.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Save answer"),
		) as HTMLButtonElement;
		expect(save.disabled).toBe(true);
	});

	it("keeps the answer and exposes retry when the server rejects a stale revision", async () => {
		await render({ requests: [request("alpha", "decision")] });
		const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
		const checkbox = document
			.querySelectorAll("input[type=checkbox]")
			.item(document.querySelectorAll("input[type=checkbox]").length - 1) as HTMLInputElement;
		await act(async () => {
			Object.getOwnPropertyDescriptor(dom!.window.HTMLTextAreaElement.prototype, "value")?.set?.call(
				textarea,
				"Keep this answer",
			);
			textarea.dispatchEvent(new dom!.window.Event("input", { bubbles: true }));
			checkbox.click();
		});
		const save = Array.from(document.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Save answer"),
		) as HTMLButtonElement;
		await act(async () => save.click());
		expect(document.body.textContent).toContain("stale revision");
		expect(document.querySelector("textarea")?.value).toBe("Keep this answer");
		expect(document.body.textContent).toContain("Retry save");
		expect(document.body.textContent).toContain("Answer saved: unknown");
	});

	it("joins rq-shaped snake_case requests with task manual cases and material content", async () => {
		await render({
			requests: [
				{
					request_id: "rq-1",
					kind: "acceptance",
					workspace_id: "alpha",
					ticket: "BACK-9",
					current_revision: "3",
					materials: ["evidence.md"],
				},
			],
			tasks: [
				{
					workspace_id: "alpha",
					original_id: "BACK-9",
					manual_cases: [
						{
							id: "M1",
							assertion: "Check the entry",
							pre: "fixture ready",
							step: "open page",
							op: "click",
							expect: "saved",
							actual: "pending",
						},
					],
				},
			],
		});
		expect(document.body.textContent).toContain("Check the entry");
		expect(document.body.textContent).toContain("pre: fixture ready");
		expect(document.body.textContent).toContain("actual: pending");
		const show = Array.from(document.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Show material"),
		) as HTMLButtonElement;
		expect(show).toBeTruthy();
		await act(async () => show.click());
		await act(async () => await new Promise((resolve) => setTimeout(resolve, 200)));
		expect(document.body.textContent).toContain("real material content");
	});

	it("loads every preview material when rq returns an array", async () => {
		setup({
			requests: [
				{
					request_id: "rq-materials",
					kind: "acceptance",
					workspace_id: "alpha",
					ticket: "BACK-9",
					materials: ["one.md"],
					preview: ["two.md", "three.md"],
				},
			],
		});
		const paths: string[] = [];
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("/material")) {
				const path = new URL(url, "http://localhost").searchParams.get("path") ?? "";
				paths.push(path);
				return new Response(JSON.stringify({ ok: true, data: { content: `content:${path}` } }), { status: 200 });
			}
			return new Response(
				JSON.stringify({
					requests: [
						{
							request_id: "rq-materials",
							kind: "acceptance",
							workspace_id: "alpha",
							ticket: "BACK-9",
							materials: ["one.md"],
							preview: ["two.md", "three.md"],
						},
					],
				}),
				{ status: 200 },
			);
		}) as typeof fetch;
		root = createRoot(document.getElementById("root")!);
		await act(async () => {
			root?.render(
				<MemoryRouter initialEntries={["/?workspace=alpha"]}>
					<WorkflowInbox workspaces={[{ id: "alpha", name: "Alpha", writable: true }]} />
				</MemoryRouter>,
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		const show = Array.from(document.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Show material"),
		) as HTMLButtonElement;
		await act(async () => show.click());
		await act(async () => await new Promise((resolve) => setTimeout(resolve, 200)));
		expect(paths.sort()).toEqual(["one.md", "three.md", "two.md"]);
		expect(document.body.textContent).toContain("content:one.md");
		expect(document.body.textContent).toContain("content:two.md");
		expect(document.body.textContent).toContain("content:three.md");
	});

	it("renders task session facts without inferring missing lifecycle signals", async () => {
		await setup({
			requests: [
				{
					request_id: "rq-2",
					kind: "review",
					workspace_id: "alpha",
					task_id: "BACK-2",
					current_action: "historical-answer",
					waiting_reason: "historical",
					saved: "yes",
				},
			],
			tasks: [
				{
					workspace_id: "alpha",
					original_id: "BACK-2",
					action: "running",
					waiting_reason: "agent",
					updated_at: "2026-10-26T03:04:05Z",
				},
			],
		});
		root = createRoot(document.getElementById("root")!);
		await act(async () => {
			root?.render(
				<MemoryRouter>
					<WorkflowTaskFacts taskId="BACK-2" workspaceId="alpha" />
				</MemoryRouter>,
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect(document.body.textContent).toContain("Action: running; waiting: agent");
		expect(document.body.textContent).not.toContain("historical-answer");
		expect(document.body.textContent).toContain("updated: 2026-10-26T03:04:05Z");
		expect(document.body.textContent).toContain("stale: unknown");
		expect(document.body.textContent).toContain("completed: unknown");
	});

	it("renders native task facts without a human request and joins rq reasons", async () => {
		setup({
			tasks: [
				{
					project_id: "alpha",
					original_id: "BACK-2",
					source_type: "rq",
					action: "running",
					reasons: ["waiting for agent", "waiting for material"],
					session_id: "session-a",
					updated_at: "2026-10-26T03:04:05Z",
				},
			],
			agents: {
				source: "local-session-files",
				available: true,
				collected_at: "2026-10-26T03:05:00Z",
				items: [{ session_id: "session-a", project_id: "alpha", source: "terminal" }],
			},
		});
		root = createRoot(document.getElementById("root")!);
		await act(async () => {
			root?.render(
				<MemoryRouter>
					<WorkflowTaskFacts taskId="BACK-2" workspaceId="alpha" />
				</MemoryRouter>,
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect(document.body.textContent).toContain("Action: running");
		expect(document.body.textContent).toContain("waiting for agent; waiting for material");
		expect(document.body.textContent).toContain("Session: session-a");
		expect(document.body.textContent).toContain("source: rq");
	});

	it("does not cross-bind duplicate sessions or stale task actions", async () => {
		setup({
			requests: [
				{ request_id: "local", kind: "decision", project_id: "alpha", ticket: "BACK-2", action: "local answer" },
			],
			tasks: [
				{
					project_id: "alpha",
					original_id: "BACK-2",
					action: "running",
					session_id: "shared",
					stale: true,
					updated_at: "2026-10-26T03:04:05Z",
				},
				{ project_id: "beta", original_id: "BACK-2", action: "completed", session_id: "shared" },
			],
			agents: {
				source: "local-session-files",
				available: true,
				items: [{ session_id: "shared", project_id: "beta", source: "wrong-root" }],
			},
		});
		root = createRoot(document.getElementById("root")!);
		await act(async () => {
			root?.render(
				<MemoryRouter>
					<WorkflowTaskFacts taskId="BACK-2" workspaceId="alpha" />
				</MemoryRouter>,
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect(document.body.textContent).toContain("Action: unknown");
		expect(document.body.textContent).not.toContain("wrong-root");
	});

	it("hides same-ID requests when aggregate identity is ambiguous and scopes explicit roots", async () => {
		const snapshot = {
			requests: [
				{ request_id: "local", kind: "decision", project_id: "alpha", ticket: "BACK-5", question: "local-only" },
				{ request_id: "other", kind: "decision", project_id: "beta", ticket: "BACK-5", question: "other-only" },
			],
			tasks: [
				{ project_id: "alpha", original_id: "BACK-5", action: "local" },
				{ project_id: "beta", original_id: "BACK-5", action: "other" },
			],
		};
		setup(snapshot, "http://localhost/?workspace=all");
		root = createRoot(document.getElementById("root")!);
		await act(async () => {
			root?.render(
				<MemoryRouter initialEntries={["/?workspace=all"]}>
					<WorkflowTaskFacts taskId="BACK-5" />
				</MemoryRouter>,
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect(document.body.textContent).not.toContain("local-only");
		expect(document.body.textContent).not.toContain("other-only");
		await act(async () => {
			root?.unmount();
			root = createRoot(document.getElementById("root")!);
			root.render(
				<MemoryRouter initialEntries={["/?workspace=beta"]}>
					<WorkflowTaskFacts taskId="BACK-5" workspaceId="beta" />
				</MemoryRouter>,
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect(document.body.textContent).not.toContain("local-only");
		expect(document.body.textContent).toContain("decision");
	});

	it("keeps an unregistered single-project snapshot useful without a workspace prop", async () => {
		setup(
			{
				requests: [{ request_id: "single", kind: "decision", ticket: "BACK-6", question: "single-root" }],
				tasks: [{ original_id: "BACK-6", action: "running" }],
			},
			"http://localhost/",
		);
		root = createRoot(document.getElementById("root")!);
		await act(async () => {
			root?.render(
				<MemoryRouter>
					<WorkflowTaskFacts taskId="BACK-6" />
				</MemoryRouter>,
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect(document.body.textContent).toContain("decision");
		expect(document.body.textContent).toContain("Action: running");
	});

	it("shows unknown action when the matched signal is explicitly stale", async () => {
		setup({
			tasks: [
				{
					project_id: "alpha",
					original_id: "BACK-3",
					action: "deploy",
					stale: true,
					updated_at: "2026-10-26T03:04:05Z",
				},
			],
		});
		root = createRoot(document.getElementById("root")!);
		await act(async () => {
			root?.render(
				<MemoryRouter>
					<WorkflowTaskFacts taskId="BACK-3" workspaceId="alpha" />
				</MemoryRouter>,
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect(document.body.textContent).toContain("Action: unknown");
		expect(document.body.textContent).toContain("observed: 2026-10-26T03:04:05Z");
		expect(document.body.textContent).toContain("stale: yes");
	});

	it("does not bind a task when its project identity is missing", async () => {
		setup({ tasks: [{ original_id: "BACK-4", action: "running" }] });
		root = createRoot(document.getElementById("root")!);
		await act(async () => {
			root?.render(
				<MemoryRouter>
					<WorkflowTaskFacts taskId="BACK-4" workspaceId="alpha" />
				</MemoryRouter>,
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect(document.body.textContent).toContain("No bound workflow task facts found.");
		expect(document.body.textContent).not.toContain("Action: running");
	});

	it("fails closed for aggregate same-ID tasks with incomplete workspace identity", async () => {
		setup(
			{
				requests: [
					{ request_id: "foreign", kind: "review", project_id: "alpha", ticket: "BACK-7", question: "foreign request" },
				],
				tasks: [
					{ original_id: "BACK-7", action: "running" },
					{ project_id: "beta", original_id: "BACK-7", action: "completed" },
				],
			},
			"http://localhost/?workspace=all",
		);
		root = createRoot(document.getElementById("root")!);
		await act(async () => {
			root?.render(
				<MemoryRouter initialEntries={["/?workspace=all"]}>
					<WorkflowTaskFacts taskId="BACK-7" />
				</MemoryRouter>,
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect(document.body.textContent).not.toContain("foreign request");
		expect(document.body.textContent).toContain("No bound workflow task facts found.");
	});

	it("shows rq transport acceptance without inferring execution", async () => {
		setup({
			tasks: [
				{
					project_id: "alpha",
					original_id: "BACK-8",
					action: "waiting",
					transport: "input_accepted",
					delivery: "running",
					delivery_at: "2026-10-26T04:05:06Z",
					session_id: "session-8",
					source_type: "rq",
				},
			],
		});
		root = createRoot(document.getElementById("root")!);
		await act(async () => {
			root?.render(
				<MemoryRouter>
					<WorkflowTaskFacts taskId="BACK-8" workspaceId="alpha" />
				</MemoryRouter>,
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect(document.body.textContent).toContain("Transport: input accepted (execution not implied)");
		expect(document.body.textContent).toContain("Delivery: running at 2026-10-26T04:05:06Z");
		expect(document.body.textContent).toContain("Action: waiting");
	});

	it("shows answered recovery and explicit session delivery facts", async () => {
		await render({
			requests: [
				{
					request_id: "rq-answered",
					kind: "review",
					workspace_id: "alpha",
					task_id: "BACK-2",
					status: "answered",
					answered_at: "2026-10-26T01:02:03Z",
					source: "approvals.jsonl",
					session_id: "session-a",
					delivery: "pending",
					stale: true,
					action: "approve",
					reply: "approved",
				},
			],
		});
		expect(document.body.textContent).toContain("answered");
		expect(document.body.textContent).toContain("pending (not executed)");
		expect(document.body.textContent).toContain("Resume bound session");
		expect(document.body.textContent).toContain("approvals.jsonl");
	});

	it("preserves an unsent draft when refresh completes", async () => {
		await render({ requests: [request("alpha", "decision")] });
		const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
		await act(async () => {
			Object.getOwnPropertyDescriptor(dom!.window.HTMLTextAreaElement.prototype, "value")?.set?.call(
				textarea,
				"Keep during refresh",
			);
			textarea.dispatchEvent(new dom!.window.Event("input", { bubbles: true }));
		});
		const refresh = Array.from(document.querySelectorAll("button")).find(
			(button) => button.textContent === "Refresh",
		) as HTMLButtonElement;
		await act(async () => {
			refresh.click();
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect((document.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Keep during refresh");
	});

	it("permits an explicit writable aggregate target but suppresses blocked approval", async () => {
		await render(
			{
				requests: [
					{ ...request("alpha", "review"), approve_blockers: ["missing evidence"], actions: ["approve", "changes"] },
				],
			},
			"http://localhost/?workspace=all",
		);
		expect(document.body.textContent).toContain("changes");
		expect(document.body.textContent).not.toContain("approve");
		expect(document.body.textContent).toContain("Cancel request");
	});

	it("restores stable draft text when the stored revision is older", async () => {
		setup({ requests: [request("alpha", "decision")] });
		localStorage.setItem(
			"backlog.workflow.draft:alpha:BACK-1:same",
			JSON.stringify({ text: "Reference answer", revision: "2" }),
		);
		root = createRoot(document.getElementById("root")!);
		await act(async () => {
			root?.render(
				<MemoryRouter initialEntries={["/?workspace=alpha"]}>
					<WorkflowInbox workspaces={[{ id: "alpha", name: "Alpha", writable: true }]} />
				</MemoryRouter>,
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect((document.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Reference answer");
	});

	it("unwraps the single-workspace workflow envelope at the API boundary", async () => {
		setup({});
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ ok: true, data: { requests: [{ request_id: "wrapped" }] } }), {
				status: 200,
			})) as unknown as typeof fetch;
		expect((await apiClient.fetchWorkflow("alpha")).requests?.[0]?.request_id).toBe("wrapped");
	});

	it("keeps workflow warnings visible without dropping requests", async () => {
		await render({
			requests: [request("alpha", "decision")],
			warnings: [{ workspaceId: "alpha", warning: "Watcher failed; using fallback checks." }],
		});
		expect(document.body.textContent).toContain("Watcher failed; using fallback checks.");
		expect(document.body.textContent).toContain("decision question alpha");
		expect(document.querySelector('[role="status"]')?.textContent).toContain("Watcher failed");
	});

	it("adds refresh only to an explicit workflow fetch", async () => {
		setup({ requests: [] }, "http://localhost/");
		const urls: string[] = [];
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			urls.push(String(input));
			return new Response(JSON.stringify({ requests: [] }), { status: 200 });
		}) as typeof fetch;
		await apiClient.fetchWorkflow();
		await apiClient.fetchWorkflow("alpha");
		await apiClient.fetchWorkflow("all");
		await apiClient.fetchWorkflow(undefined, true);
		await apiClient.fetchWorkflow("alpha", true);
		await apiClient.fetchWorkflow("all", true);
		expect(urls[0]).toBe("/api/workflow");
		expect(urls[1]).toBe("/api/workflow?workspace=alpha");
		expect(urls[2]).toBe("/api/workflow?allWorkspaces=true");
		expect(urls[3]).toBe("/api/workflow?refresh=true");
		expect(urls[4]).toBe("/api/workflow?workspace=alpha&refresh=true");
		expect(urls[5]).toBe("/api/workflow?allWorkspaces=true&refresh=true");
	});

	it("refreshes after a confirmed save without treating exit success as durable", async () => {
		let reads = 0;
		const pending = request("alpha", "decision");
		setup({ requests: [pending] });
		globalThis.fetch = (async (_input: RequestInfo | URL, options?: RequestInit) => {
			if (options?.method === "POST")
				return new Response(JSON.stringify({ ok: true, saved: true, stdout: "saved" }), { status: 200 });
			reads += 1;
			return new Response(JSON.stringify(reads > 1 ? { requests: [] } : { requests: [pending] }), { status: 200 });
		}) as typeof fetch;
		root = createRoot(document.getElementById("root")!);
		await act(async () => {
			root?.render(
				<MemoryRouter initialEntries={["/?workspace=alpha"]}>
					<WorkflowInbox workspaces={[{ id: "alpha", name: "Alpha", writable: true }]} />
				</MemoryRouter>,
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
		const checkbox = document
			.querySelectorAll("input[type=checkbox]")
			.item(document.querySelectorAll("input[type=checkbox]").length - 1) as HTMLInputElement;
		await act(async () => {
			Object.getOwnPropertyDescriptor(dom!.window.HTMLTextAreaElement.prototype, "value")?.set?.call(
				textarea,
				"Persist this answer",
			);
			textarea.dispatchEvent(new dom!.window.Event("input", { bubbles: true }));
			checkbox.click();
		});
		const save = Array.from(document.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Save answer"),
		) as HTMLButtonElement;
		await act(async () => save.click());
		expect(reads).toBeGreaterThanOrEqual(2);
		expect(document.body.textContent).toContain("Answer saved: yes");
	});

	it("submits failed human cases with changes and fingerprints their observations", async () => {
		const snapshot = {
			requests: [
				{
					...request("alpha", "review", "observed"),
					actions: ["approve", "changes"],
					checklist: [{ id: "M1", assertion: "Check output", actual: "wrong" }],
					assertions: [{ id: "A1", text: "Build", result: "PASS" }],
					evidence: { source: "rq", result: "PASS" },
				},
			],
		};
		setup(snapshot);
		let body = "";
		globalThis.fetch = (async (_input: RequestInfo | URL, options?: RequestInit) => {
			if (options?.method === "POST") {
				body = String(options.body ?? "");
				return new Response(JSON.stringify({ ok: true, saved: true }), { status: 200 });
			}
			return new Response(JSON.stringify(snapshot), { status: 200 });
		}) as typeof fetch;
		root = createRoot(document.getElementById("root")!);
		await act(async () => {
			root?.render(
				<MemoryRouter initialEntries={["/?workspace=alpha"]}>
					<WorkflowInbox workspaces={[{ id: "alpha", name: "Alpha", writable: true }]} />
				</MemoryRouter>,
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		const reply = document.querySelector("#workflow-reply") as HTMLTextAreaElement;
		const observation = document.querySelector("#workflow-check-M1-observation") as HTMLTextAreaElement;
		await act(async () => {
			Object.getOwnPropertyDescriptor(dom!.window.HTMLTextAreaElement.prototype, "value")?.set?.call(
				reply,
				"Needs changes",
			);
			reply.dispatchEvent(new dom!.window.Event("input", { bubbles: true }));
			Object.getOwnPropertyDescriptor(dom!.window.HTMLTextAreaElement.prototype, "value")?.set?.call(
				observation,
				"actual output differs",
			);
			observation.dispatchEvent(new dom!.window.Event("input", { bubbles: true }));
		});
		const changes = Array.from(document.querySelectorAll("button")).find(
			(button) => button.textContent === "changes",
		) as HTMLButtonElement;
		const approve = Array.from(document.querySelectorAll("button")).find(
			(button) => button.textContent === "approve",
		) as HTMLButtonElement;
		await act(async () => approve.click());
		const guardedSave = Array.from(document.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Save answer"),
		) as HTMLButtonElement;
		expect(guardedSave.disabled).toBe(true);
		await act(async () => changes.click());
		const save = Array.from(document.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Save answer"),
		) as HTMLButtonElement;
		expect(save.disabled).toBe(false);
		await act(async () => save.click());
		expect(body).toContain("Human check outcomes:");
		expect(body).toContain("M1: FAIL — actual output differs");
		expect(body).toContain("Needs changes");
		expect(localStorage.getItem("backlog.workflow.draft:alpha:BACK-1:observed")).toBeNull();
	});

	it("restores observations by request identity without restoring checks", async () => {
		const first = { ...request("alpha", "review", "first"), checklist: [{ id: "M1", assertion: "First case" }] };
		const second = { ...request("alpha", "review", "second"), checklist: [{ id: "M1", assertion: "Second case" }] };
		setup({ requests: [first, second] });
		localStorage.setItem(
			"backlog.workflow.draft:alpha:BACK-1:first",
			JSON.stringify({ text: "first draft", revision: "7", observations: { M1: "first observation" } }),
		);
		root = createRoot(document.getElementById("root")!);
		await act(async () => {
			root?.render(
				<MemoryRouter initialEntries={["/?workspace=alpha"]}>
					<WorkflowInbox workspaces={[{ id: "alpha", name: "Alpha", writable: true }]} />
				</MemoryRouter>,
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect((document.querySelector("#workflow-check-M1-observation") as HTMLTextAreaElement).value).toBe(
			"first observation",
		);
		const secondRow = document.querySelectorAll("tbody tr").item(1) as HTMLElement;
		await act(async () => secondRow.click());
		expect((document.querySelector("#workflow-check-M1-observation") as HTMLTextAreaElement).value).toBe("");
	});

	it("keeps answered recovery visible but prevents queueing it", async () => {
		await render({
			requests: [
				{
					...request("alpha", "review", "answered"),
					status: "answered",
					delivery: "pending",
					actions: ["approve", "changes"],
				},
			],
		});
		const queue = document.querySelector('input[aria-label="Queue answered in alpha"]') as HTMLInputElement;
		expect(queue.disabled).toBe(true);
		expect(document.body.textContent).toContain("Already answered; delivery is pending");
		expect(document.body.textContent).toContain("Resume bound session");
	});

	it("prevents queueing material-missing requests and shows approval blockers", async () => {
		await render({
			requests: [
				{
					...request("alpha", "review", "missing"),
					materialMissing: true,
					approve_blockers: ["fresh evidence required"],
					actions: ["changes"],
				},
			],
		});
		const queue = document.querySelector('input[aria-label="Queue missing in alpha"]') as HTMLInputElement;
		expect(queue.disabled).toBe(true);
		expect(document.body.textContent).toContain("Materials missing; this request is not actionable.");
		expect(document.body.textContent).toContain("Approval blocked: fresh evidence required");
	});

	it("keeps authorization action distinct from task current action", async () => {
		await render({
			requests: [
				{ ...request("alpha", "authorization", "auth-action"), question: "Authorize deployment", action: undefined },
			],
			tasks: [{ project_id: "alpha", original_id: "BACK-1", action: "running" }],
		});
		expect(document.body.textContent).toContain("Authorize deployment");
		expect(document.body.textContent).toContain("ActionAuthorize deployment");
	});
});
