import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { Task } from "../types/index.ts";
import TaskList from "../web/components/TaskList.tsx";
import WorkspaceSwitcher from "../web/components/WorkspaceSwitcher.tsx";

let root: Root | null = null;
let activeDom: JSDOM | null = null;
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalNavigator = globalThis.navigator;
const originalLocalStorage = globalThis.localStorage;
const originalActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;

afterEach(async () => {
	await act(async () => {
		root?.unmount();
	});
	activeDom?.window.close();
	activeDom = null;
	root = null;
	globalThis.fetch = originalFetch;
	globalThis.window = originalWindow;
	globalThis.document = originalDocument;
	globalThis.navigator = originalNavigator;
	globalThis.localStorage = originalLocalStorage;
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
});

describe("WorkspaceSwitcher", () => {
	function LocationProbe() {
		const location = useLocation();
		return <output data-testid="location">{location.search}</output>;
	}
	it("renders available roots, marks read-only roots, and persists selection", async () => {
		const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
			url: "http://localhost/?workspace=all",
		});
		activeDom = dom;
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		globalThis.window = dom.window as unknown as Window & typeof globalThis;
		globalThis.document = dom.window.document;
		globalThis.localStorage = dom.window.localStorage;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify([
					{ id: "alpha", name: "Alpha", rootPath: "C:/alpha", writable: true },
					{ id: "beta", name: "Beta", rootPath: "C:/beta", writable: false },
				]),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			)) as unknown as typeof fetch;

		root = createRoot(document.getElementById("root")!);
		await act(async () => {
			root?.render(
				<MemoryRouter initialEntries={["/?workspace=all&taskWorkspace=beta&view=detail"]}>
					<WorkspaceSwitcher />
					<LocationProbe />
				</MemoryRouter>,
			);
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		const select = document.querySelector("select") as HTMLSelectElement;
		expect(select).not.toBeNull();
		expect(select.options[0]?.textContent).toBe("Current project");
		expect(select.options[1]?.textContent).toBe("All directory projects");
		expect(select.options[2]?.textContent).toBe("Alpha");
		expect(select.options[3]?.textContent).toBe("Beta (read-only)");

		await act(async () => {
			select.value = "alpha";
			select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect(window.localStorage.getItem("backlog.workspace")).toBe("alpha");
		expect(document.querySelector("[data-testid=location]")?.textContent).toContain("workspace=alpha");
		expect(document.querySelector("[data-testid=location]")?.textContent).not.toContain("taskWorkspace");
	});

	it("keeps same task IDs distinct by directory project in the rendered list", async () => {
		const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
			url: "http://localhost/?workspace=all",
		});
		activeDom = dom;
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		globalThis.window = dom.window as unknown as Window & typeof globalThis;
		globalThis.document = dom.window.document;
		globalThis.localStorage = dom.window.localStorage;
		const task = (workspaceId: string): Task =>
			({
				id: "BACK-1",
				title: `${workspaceId} task`,
				status: "To Do",
				assignee: [],
				labels: [],
				dependencies: [],
				createdDate: "2026-01-01",
				workspaceId,
			}) as Task;
		root = createRoot(document.getElementById("root")!);
		await act(async () => {
			root?.render(
				<MemoryRouter initialEntries={["/?workspace=all"]}>
					<TaskList
						onEditTask={() => undefined}
						onNewTask={() => undefined}
						tasks={[task("alpha"), task("beta")]}
						availableStatuses={["To Do"]}
						availableLabels={[]}
						availableMilestones={[]}
						milestoneEntities={[]}
						archivedMilestones={[]}
						readOnly
					/>
				</MemoryRouter>,
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		const rows = Array.from(document.querySelectorAll("tbody tr"));
		expect(rows).toHaveLength(2);
		expect(rows[0]?.textContent).toContain("alpha");
		expect(rows[1]?.textContent).toContain("beta");
	});
});
