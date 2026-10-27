import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import WorkflowRequestChecks from "../web/components/WorkflowRequestChecks.tsx";

let root: Root | null = null;
let dom: JSDOM | null = null;

afterEach(async () => {
	await act(async () => root?.unmount());
	dom?.window.close();
	root = null;
	dom = null;
});

describe("WorkflowRequestChecks", () => {
	it("keeps machine assertions/evidence separate from unchecked human checks", async () => {
		dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
		globalThis.window = dom.window as unknown as Window & typeof globalThis;
		globalThis.document = dom.window.document;
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		root = createRoot(document.getElementById("root")!);
		await act(async () => {
			root?.render(
				<WorkflowRequestChecks
					assertions={[{ id: "A1", text: "Build passed", result: "PASS" }]}
					evidence={{ receipt: true, findings: { critical: 0 } }}
					manualCases={[
						{
							id: "M1",
							assertion: "A1",
							pre: "Ready",
							step: "Open",
							op: "click",
							expect: "Visible",
							actual: "Pending",
						},
					]}
					checks={{}}
					observations={{}}
					onCheckChange={() => undefined}
					onObservationChange={() => undefined}
				/>,
			);
		});
		expect(document.body.textContent).toContain("A1");
		expect(document.body.textContent).toContain("Build passed");
		expect(document.body.textContent).toContain("PASS");
		expect(document.body.textContent).toContain("receipt");
		expect(document.body.textContent).toContain("M1");
		expect(document.body.textContent).toContain("Pending");
		expect((document.querySelector("input[type=checkbox]") as HTMLInputElement).checked).toBe(false);
	});

	it("emits controlled check and failure-observation changes", async () => {
		dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
		globalThis.window = dom.window as unknown as Window & typeof globalThis;
		globalThis.document = dom.window.document;
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		const checks: Array<[string, boolean]> = [];
		const observations: Array<[string, string]> = [];
		root = createRoot(document.getElementById("root")!);
		await act(async () => {
			root?.render(
				<WorkflowRequestChecks
					manualCases={[{ id: "M2", assertion: "A2" }]}
					checks={{}}
					observations={{}}
					onCheckChange={(id, value) => checks.push([id, value])}
					onObservationChange={(id, value) => observations.push([id, value])}
				/>,
			);
		});
		const checkbox = document.querySelector("input[type=checkbox]") as HTMLInputElement;
		const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
		await act(async () => {
			checkbox.click();
			Object.getOwnPropertyDescriptor(dom!.window.HTMLTextAreaElement.prototype, "value")?.set?.call(
				textarea,
				"Observed mismatch",
			);
			textarea.dispatchEvent(new dom!.window.Event("input", { bubbles: true }));
		});
		expect(checks).toEqual([["M2", true]]);
		expect(observations).toEqual([["M2", "Observed mismatch"]]);
	});
});
