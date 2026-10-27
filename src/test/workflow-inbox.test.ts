import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ScreenInterface } from "neo-neo-bblessed";
import { createScreen } from "../ui/tui.ts";
import {
	openWorkflowInbox,
	parseWorkflowSnapshot,
	workflowActions,
	workflowIdempotencyKey,
	workflowManualCases,
	workflowMaterials,
	workflowRequestVisible,
	workflowRevision,
} from "../ui/workflow-inbox.ts";

let fixtureRoot: string | undefined;

afterEach(async () => {
	if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
	fixtureRoot = undefined;
});

type EmittingWidget = {
	emit: (event: string, ch?: string, key?: { name: string; full: string; ctrl?: boolean }) => boolean;
	children?: EmittingWidget[];
	focus?: () => void;
	getScroll?: () => number;
	getScrollHeight?: () => number;
	getValue?: () => string;
	setValue?: (value: string) => void;
};

function pressKey(widget: EmittingWidget | undefined, full: string, name = full): void {
	if (!widget) throw new Error(`No focused widget for ${full}`);
	const key = { name, full, ctrl: full === "C-d" || full === "C-u" };
	widget.emit("keypress", "", key);
	widget.emit(`key ${full}`, "", key);
}

function pressScreenKey(screen: ScreenInterface, name: string, sequence: string): void {
	(screen as unknown as { program: { emit: (event: string, ch: string, key: unknown) => void } }).program.emit(
		"keypress",
		"",
		{ name, full: name, sequence },
	);
}

function typeScreenText(screen: ScreenInterface, value: string): void {
	const program = (screen as unknown as { program: { emit: (event: string, ch: string, key: unknown) => void } })
		.program;
	for (const character of Array.from(value)) {
		program.emit("keypress", character, { name: character, full: character, sequence: character });
	}
}

function descendants(widget: EmittingWidget): EmittingWidget[] {
	return [widget, ...(widget.children ?? []).flatMap(descendants)];
}

describe("native workflow inbox snapshot", () => {
	test("accepts rq's request and agent object shapes", () => {
		const snapshot = parseWorkflowSnapshot(
			JSON.stringify({
				schema_version: 1,
				requests: [
					{
						request_id: "req-1",
						kind: "authorization",
						status: "pending",
						actions: ["allow", "deny"],
						approve_blockers: ["missing evidence"],
					},
				],
				agents: {
					source: "local-session-files",
					available: true,
					collected_at: "2026-10-26T00:00:00Z",
					items: [{ session_id: "s-1" }],
				},
			}),
		);
		expect(snapshot.requests?.[0]?.request_id).toBe("req-1");
		expect(snapshot.agents?.available).toBe(true);
		expect(snapshot.requests?.[0]?.approve_blockers).toEqual(["missing evidence"]);
	});

	test("rejects a non-object snapshot", () => {
		expect(() => parseWorkflowSnapshot("[]")).toThrow("invalid board snapshot");
	});

	test("joins rq original_id and gates approval actions on blockers", () => {
		const snapshot = parseWorkflowSnapshot(
			JSON.stringify({
				tasks: [
					{
						project_id: "alpha",
						original_id: "BACK-9",
						manual_cases: [{ id: "M1", pre: "clean", step: "run", op: "click", expect: "pass", actual: "" }],
					},
				],
			}),
		);
		const request = {
			request_id: "rq-1",
			project_id: "alpha",
			ticket: "BACK-9",
			actions: ["approve", "changes"],
			approve_blockers: ["missing evidence"],
		};
		expect(workflowManualCases(snapshot, request)).toEqual([
			{ id: "M1", pre: "clean", step: "run", op: "click", expect: "pass", actual: "" },
		]);
		expect(workflowActions(request)).toEqual(["changes"]);
		expect(workflowIdempotencyKey(request, "changes", "same")).toBe(workflowIdempotencyKey(request, "changes", "same"));
		expect(workflowIdempotencyKey(request, "changes", "same")).not.toBe(
			workflowIdempotencyKey(request, "changes", "changed"),
		);
	});

	test("keeps answered requests visible only while delivery is recoverable", () => {
		expect(workflowRequestVisible({ request_id: "pending", status: "pending" })).toBe(true);
		expect(
			workflowRequestVisible({ request_id: "answered", status: "answered", delivery: { status: "pending" } }),
		).toBe(true);
		expect(workflowRequestVisible({ request_id: "done", status: "answered", delivery: "completed" })).toBe(false);
		expect(workflowRequestVisible({ request_id: "missing", status: "cancelled" })).toBe(false);
	});

	test("preserves all materials and makes empty revisions explicit", () => {
		expect(workflowMaterials({ materials: ["one.md", "two.md"] })).toEqual(["one.md", "two.md"]);
		expect(workflowMaterials({ materials: [], preview: ["preview-a", "preview-b"] })).toEqual([
			"preview-a",
			"preview-b",
		]);
		expect(workflowRevision({ current_revision: "", revision: "   " })).toBe("unknown");
		expect(workflowRevision({ current_revision: "rev-2", revision: "rev-1" })).toBe("rev-2");
	});

	test("scrolls PageDown and preserves a rejected-permission reply draft for retry", async () => {
		fixtureRoot = await mkdtemp(join(process.env.TEMP ?? process.env.TMP ?? ".", "workflow-inbox-screen-"));
		await mkdir(join(fixtureRoot, "backlog"), { recursive: true });
		const manualCases = Array.from({ length: 20 }, (_, index) => ({
			id: `M${index + 1}`,
			assertion: "A1",
			pre: "fixture ready",
			step: `step-${index + 1}`,
			op: "read",
			expect: "visible",
			actual: "pending",
		}));
		const snapshot: { tasks: Array<Record<string, unknown>>; requests: Array<Record<string, unknown>> } = {
			tasks: [
				{
					project_id: "fixture",
					original_id: "TASK-3",
					assertions: [{ id: "A1", text: "machine assertion", result: "PASS" }],
					evidence: { exists: true, receipt: true, logs: ["run.log"] },
					manual_cases: manualCases,
				},
			],
			requests: [
				{
					request_id: "E2E-SCREEN",
					ticket: "TASK-3",
					project_id: "fixture",
					kind: "decision",
					question: "Choose a non-approval continuation",
					recommendation: "Continue",
					scope: "fixture only",
					actions: ["changes"],
					status: "pending",
					current_revision: "r1",
				},
			],
		};
		const root = fixtureRoot;
		if (!root) throw new Error("fixture root was not created");
		let responseState: Record<string, string> | undefined;
		const runner = async (argv: string[]) => {
			if (argv.includes("respond")) {
				const responseIndex = argv.indexOf("respond");
				const action = argv[argv.indexOf("--action") + 1] ?? "";
				const idempotencyKey = argv[argv.indexOf("--idempotency-key") + 1] ?? "";
				responseState = { reply: argv[responseIndex + 2] ?? "", action, idempotency_key: idempotencyKey };
				await writeFile(join(root, ".response-state.json"), JSON.stringify(responseState), "utf8");
				return { exitCode: 0, stdout: "accepted", stderr: "" };
			}
			const current = structuredClone(snapshot) as typeof snapshot;
			if (responseState) {
				current.requests[0] = {
					...(current.requests[0] ?? {}),
					status: "answered",
					...responseState,
					delivery: "pending",
				};
			}
			return { exitCode: 0, stdout: JSON.stringify(current), stderr: "" };
		};
		const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
		Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
		const screen = createScreen({ smartCSR: false }) as ScreenInterface & EmittingWidget;
		Object.defineProperties(screen, { width: { value: 80 }, height: { value: 24 } });
		let writable = false;
		try {
			const inbox = openWorkflowInbox({
				screen,
				options: {
					root: fixtureRoot,
					enabled: true,
					runner,
					writable: true,
					assertWritable: async () => {
						if (!writable) throw new Error("permission revoked");
					},
				},
			});
			await Bun.sleep(120);
			const widgets = descendants(screen as unknown as EmittingWidget);
			const rows = widgets.find((item) => (item as unknown as { type?: string }).type === "list");
			const detail = widgets.find((item) => (item as unknown as { type?: string }).type === "scrollable-box");
			rows?.focus?.();
			pressKey(rows, "tab");
			await Bun.sleep(20);
			expect(detail).toBeDefined();
			const initialScroll = detail?.getScroll?.() ?? 0;
			pressScreenKey(screen, "pagedown", "\x1b[6~");
			await Bun.sleep(20);
			expect(detail?.getScroll?.() ?? 0).toBeGreaterThan(initialScroll);

			pressKey(detail, "escape");
			await Bun.sleep(10);
			pressKey(rows, "o");
			await Bun.sleep(20);
			const observation = descendants(screen as unknown as EmittingWidget).find(
				(child) => typeof child.getValue === "function",
			);
			expect(observation).toBeDefined();
			if (!observation) throw new Error("observation textbox was not created");
			expect((screen as unknown as { focused?: unknown }).focused).toBe(observation);
			const selectedBeforeObservation = (rows as unknown as { selected?: number }).selected;
			typeScreenText(screen, "M2: 失败现象 exact");
			pressScreenKey(screen, "enter", "\r");
			await Bun.sleep(20);
			expect((rows as unknown as { selected?: number }).selected).toBe(selectedBeforeObservation);
			expect(
				descendants(screen as unknown as EmittingWidget).some((child) => typeof child.getValue === "function"),
			).toBe(false);
			pressKey(rows, "enter");
			await Bun.sleep(20);
			const reply = descendants(screen as unknown as EmittingWidget).find(
				(child) => typeof child.getValue === "function",
			);
			expect(reply).toBeDefined();
			if (!reply) throw new Error("reply textbox was not created");
			reply.setValue?.("exact retry draft");
			pressKey(reply, "enter");
			await Bun.sleep(30);
			expect(reply.getValue?.()).toBe("exact retry draft");
			writable = true;
			pressKey(reply, "enter");
			await Bun.sleep(120);
			const responseState = await readFile(join(fixtureRoot, ".response-state.json"), "utf8");
			expect(responseState).toContain("exact retry draft");
			expect(responseState).toContain("M1: UNCHECKED");
			expect(responseState).toContain("M2: FAIL 失败现象 exact");
			pressKey(rows, "q");
			await inbox;
		} finally {
			screen.destroy();
			if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor);
			else Reflect.deleteProperty(process.stdout, "isTTY");
		}
	});
});
