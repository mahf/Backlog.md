import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { Task } from "../types/index.ts";
import { TaskDetailsModal } from "../web/components/TaskDetailsModal";
import { TaskIdIndexProvider } from "../web/contexts/TaskIdIndexContext.tsx";
import { ThemeProvider } from "../web/contexts/ThemeContext";
import { setNativeInputValue } from "./react-dom-input.ts";

let activeRoot: Root | null = null;
let activeDom: JSDOM | null = null;
let currentPath = "";

const dependency: Task = {
	id: "BACK-2",
	title: "Dependency task",
	status: "To Do",
	assignee: [],
	createdDate: "2026-08-07",
	labels: [],
	dependencies: [],
};

const task: Task = {
	id: "BACK-1",
	title: "Task being edited",
	status: "To Do",
	assignee: [],
	createdDate: "2026-08-07",
	labels: [],
	dependencies: ["BACK-2"],
	references: [],
	comments: [{ index: 1, body: "Blocked by BACK-2 until it lands.", createdDate: "2026-08-07" }],
};

const setupDom = () => {
	activeDom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
		url: "http://localhost",
	});
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.window = activeDom.window as unknown as Window & typeof globalThis;
	globalThis.document = activeDom.window.document as Document;
	globalThis.navigator = activeDom.window.navigator as Navigator;
	globalThis.localStorage = activeDom.window.localStorage;
	globalThis.Element = activeDom.window.Element;
	globalThis.HTMLElement = activeDom.window.HTMLElement;
	globalThis.HTMLInputElement = activeDom.window.HTMLInputElement;
	globalThis.HTMLTextAreaElement = activeDom.window.HTMLTextAreaElement;
	globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(callback, 0);
	globalThis.cancelAnimationFrame = (handle: number) => window.clearTimeout(handle);

	window.matchMedia = () =>
		({
			matches: false,
			media: "",
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		}) as MediaQueryList;

	const htmlElementPrototype = window.HTMLElement.prototype as unknown as {
		attachEvent?: () => void;
		detachEvent?: () => void;
	};
	htmlElementPrototype.attachEvent = () => {};
	htmlElementPrototype.detachEvent = () => {};
};

function LocationProbe() {
	currentPath = useLocation().pathname;
	return null;
}

const renderModal = async (modalTask: Task | undefined): Promise<HTMLElement> => {
	setupDom();
	currentPath = "";
	const container = document.getElementById("root");
	activeRoot = createRoot(container as HTMLElement);
	await act(async () => {
		activeRoot?.render(
			<MemoryRouter initialEntries={["/tasks/BACK-1"]}>
				<ThemeProvider>
					<TaskIdIndexProvider tasks={[task, dependency]}>
						<LocationProbe />
						<TaskDetailsModal
							task={modalTask}
							isOpen={true}
							onClose={() => {}}
							availableTasks={[task, dependency]}
						/>
					</TaskIdIndexProvider>
				</ThemeProvider>
			</MemoryRouter>,
		);
		await Promise.resolve();
	});
	return container as HTMLElement;
};

/** Existing task, opens in preview mode. */
const mountModal = () => renderModal(task);
/** No task, opens in create mode. */
const mountCreateModal = () => renderModal(undefined);

const click = async (element: Element): Promise<MouseEvent> => {
	const event = new window.MouseEvent("click", { bubbles: true, cancelable: true });
	await act(async () => {
		element.dispatchEvent(event);
		await Promise.resolve();
	});
	return event;
};

const typeInto = async (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
	await act(async () => {
		setNativeInputValue(element, value);
		await Promise.resolve();
	});
};

const pressEnter = async (element: Element) => {
	await act(async () => {
		element.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		await Promise.resolve();
	});
};

const startEditing = async (container: HTMLElement) => {
	const editButton = Array.from(container.querySelectorAll("button")).find(
		(button) => button.textContent?.trim() === "Edit",
	);
	expect(editButton).toBeTruthy();
	await click(editButton as Element);
};

const declineOnConfirm = () => {
	const prompts: string[] = [];
	window.confirm = (message?: string) => {
		prompts.push(message ?? "");
		return false;
	};
	return prompts;
};

const startEditingWithUnsavedChanges = async (container: HTMLElement) => {
	await startEditing(container);

	const titleInput = Array.from(container.querySelectorAll("input")).find((input) => input.value === task.title);
	expect(titleInput).toBeTruthy();
	await typeInto(titleInput as HTMLInputElement, "Task being edited with unsaved work");
};

const findLinkByText = (container: HTMLElement, text: string): HTMLAnchorElement => {
	const link = Array.from(container.querySelectorAll('a[href="/tasks/BACK-2"]')).find(
		(candidate) => candidate.textContent === text,
	);
	expect(link, `link "${text}"`).toBeTruthy();
	return link as HTMLAnchorElement;
};

/** Dependency chip: a react-router link that changes the route in place. */
const findChipLink = (container: HTMLElement) => findLinkByText(container, `${dependency.id} - ${dependency.title}`);
/** Auto-linked task ID in a comment: a plain anchor that would reload the page. */
const findCommentLink = (container: HTMLElement) => findLinkByText(container, dependency.id);

afterEach(() => {
	if (activeRoot) {
		act(() => {
			activeRoot?.unmount();
		});
		activeRoot = null;
	}
	activeDom?.window.close();
	activeDom = null;
});

describe("Task details modal navigation with unsaved edits", () => {
	it("keeps the editor open when a dependency chip is clicked and the discard prompt is declined", async () => {
		const container = await mountModal();
		await startEditingWithUnsavedChanges(container);

		let prompts = 0;
		window.confirm = () => {
			prompts += 1;
			return false;
		};

		const event = await click(findChipLink(container));

		expect(prompts).toBe(1);
		expect(event.defaultPrevented).toBe(true);
		expect(currentPath).toBe("/tasks/BACK-1");
	});

	it("navigates from a dependency chip once the discard prompt is accepted", async () => {
		const container = await mountModal();
		await startEditingWithUnsavedChanges(container);

		window.confirm = () => true;

		await click(findChipLink(container));

		expect(currentPath).toBe("/tasks/BACK-2");
	});

	it("protects a comment draft that is the only unsaved work", async () => {
		const container = await mountModal();
		await startEditing(container);

		const commentBox = container.querySelector('textarea[placeholder="Add a comment..."]');
		expect(commentBox).toBeTruthy();
		await typeInto(commentBox as HTMLTextAreaElement, "Draft comment nobody has submitted yet");

		const prompts = declineOnConfirm();
		const event = await click(findChipLink(container));

		expect(prompts.length).toBe(1);
		expect(event.defaultPrevented).toBe(true);
		expect(currentPath).toBe("/tasks/BACK-1");
	});

	it("protects create-mode metadata entered before any title", async () => {
		const container = await mountCreateModal();

		const dependencyInput = container.querySelector("#dependency-input");
		expect(dependencyInput).toBeTruthy();
		await typeInto(dependencyInput as HTMLTextAreaElement, dependency.id);
		await pressEnter(dependencyInput as Element);

		const prompts = declineOnConfirm();
		const event = await click(findChipLink(container));

		expect(prompts.length).toBe(1);
		expect(event.defaultPrevented).toBe(true);
		expect(currentPath).toBe("/tasks/BACK-1");
	});

	it("blocks an auto-linked task ID in a comment when the discard prompt is declined", async () => {
		const container = await mountModal();
		await startEditingWithUnsavedChanges(container);

		window.confirm = () => false;

		const event = await click(findCommentLink(container));

		expect(event.defaultPrevented).toBe(true);
	});

	it("lets links through while there is nothing unsaved to lose", async () => {
		const container = await mountModal();

		let prompts = 0;
		window.confirm = () => {
			prompts += 1;
			return false;
		};

		await click(findChipLink(container));

		expect(prompts).toBe(0);
		expect(currentPath).toBe("/tasks/BACK-2");
	});

	it("navigates the outline within the content without prompting about unsaved edits", async () => {
		const container = await mountModal();
		await startEditingWithUnsavedChanges(container);
		const prompts = declineOnConfirm();
		const scrollCalls: ScrollToOptions[] = [];
		const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
		Object.defineProperty(HTMLElement.prototype, "scrollTo", {
			configurable: true,
			value: (options: ScrollToOptions) => scrollCalls.push(options),
		});

		const sectionNav = container.querySelector('[aria-label="Task sections"]');
		const outlineButtons = Array.from(sectionNav?.querySelectorAll<HTMLButtonElement>("[data-section]") ?? []);
		expect(outlineButtons.length).toBeGreaterThan(0);
		for (const button of outlineButtons) {
			const id = button.getAttribute("data-section");
			expect(id).toBeTruthy();
			expect(container.querySelector(`[data-task-section="${id}"]`)).toBeTruthy();
		}

		const targetSection = container.querySelector<HTMLElement>('[data-task-section="implementation-plan"]');
		const contentScroller = container.querySelector<HTMLElement>("[data-task-section=description]")?.parentElement;
		expect(targetSection).toBeTruthy();
		expect(contentScroller).toBeTruthy();
		Object.defineProperty(contentScroller, "scrollTop", { configurable: true, value: 20, writable: true });
		Object.defineProperty(contentScroller, "scrollHeight", { configurable: true, value: 500 });
		Object.defineProperty(contentScroller, "clientHeight", { configurable: true, value: 200 });
		Object.defineProperty(contentScroller, "getBoundingClientRect", { configurable: true, value: () => ({ top: 100 }) });
		Object.defineProperty(targetSection, "getBoundingClientRect", { configurable: true, value: () => ({ top: 350 }) });
		try {
			const planButton = outlineButtons.find((button) => button.textContent?.trim() === "Implementation Plan") as HTMLButtonElement;
			await click(planButton);

			expect(prompts).toHaveLength(0);
			expect(scrollCalls).toHaveLength(1);
			expect(scrollCalls[0]?.top).toBe(270);
			expect(scrollCalls[0]?.behavior).toBe("auto");
			expect(planButton.getAttribute("aria-current")).toBe("location");
			expect(planButton.className).toContain("bg-blue-50");

			for (const section of Array.from(container.querySelectorAll<HTMLElement>("[data-task-section]"))) {
				Object.defineProperty(section, "getBoundingClientRect", { configurable: true, value: () => ({ top: 500 }) });
			}
			Object.defineProperty(container.querySelector('[data-task-section="description"]'), "getBoundingClientRect", {
				configurable: true,
				value: () => ({ top: 110 }),
			});
			Object.defineProperty(container.querySelector('[data-task-section="acceptance-criteria"]'), "getBoundingClientRect", {
				configurable: true,
				value: () => ({ top: 120 }),
			});
			Object.defineProperty(container.querySelector('[data-task-section="definition-of-done"]'), "getBoundingClientRect", {
				configurable: true,
				value: () => ({ top: 180 }),
			});
			await act(async () => {
				contentScroller?.dispatchEvent(new window.Event("scroll", { bubbles: true }));
				await Promise.resolve();
			});
			expect(sectionNav?.querySelector('[data-section="acceptance-criteria"]')?.getAttribute("aria-current")).toBe("location");
		} finally {
			if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
			else Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: undefined });
		}
	});

	it("toggles the outline from its sidebar header and preserves focus when collapsed", async () => {
		const container = await mountModal();
		const sectionNav = container.querySelector('[aria-label="Task sections"]');
		const toggle = sectionNav?.querySelector<HTMLButtonElement>("[data-outline-toggle]") ?? null;
		const heading = sectionNav?.querySelector("h2");
		if (!toggle) throw new Error("Outline toggle is missing");
		expect(heading?.textContent).toBe("Outline");
		expect(toggle?.textContent?.trim()).toBe("");
		expect(toggle?.getAttribute("aria-label")).toBe("Hide task outline");
		expect(toggle?.title).toBe("Hide task outline");
		expect(toggle?.getAttribute("aria-expanded")).toBe("true");
		expect(toggle?.getAttribute("aria-controls")).toBe("task-outline-content");
		expect(toggle?.parentElement?.textContent).toContain("Outline");
		expect(container.querySelector("#task-outline-content ul")).toBeTruthy();

		(toggle as HTMLButtonElement).focus();
		await click(toggle as HTMLButtonElement);
		expect(toggle?.getAttribute("aria-expanded")).toBe("false");
		expect(toggle?.getAttribute("aria-label")).toBe("Show task outline");
		expect(toggle?.title).toBe("Show task outline");
		expect(document.activeElement).toBe(toggle);
		expect(sectionNav).toBeTruthy();
		expect(container.querySelector("#task-outline-content ul")).toBeNull();
		const compactGrid = Array.from(container.querySelectorAll("div")).find((element) =>
			element.className.includes("lg:grid-cols-[minmax(0,1fr)_18rem]"),
		);
		expect(compactGrid).toBeTruthy();
		expect(sectionNav?.className).toContain("lg:absolute");
		expect(sectionNav?.className).toContain("lg:left-0");
		expect(sectionNav?.className).toContain("lg:top-0");
		expect(sectionNav?.className).toContain("border-r-0");
		expect(sectionNav?.className).toContain("lg:overflow-visible");

		await click(toggle as HTMLButtonElement);
		expect(toggle?.getAttribute("aria-expanded")).toBe("true");
		expect(toggle?.getAttribute("aria-label")).toBe("Hide task outline");
		expect(container.querySelector("#task-outline-content ul")).toBeTruthy();
		const expandedGrid = Array.from(container.querySelectorAll("div")).find((element) =>
			element.className.includes("lg:grid-cols-[11rem_minmax(0,1fr)_18rem]"),
		);
		expect(expandedGrid).toBeTruthy();
		expect(sectionNav?.className).not.toContain("lg:absolute");
		expect(sectionNav?.className).toContain("border-r");
		expect(sectionNav?.className).toContain("lg:overflow-y-auto");
	});

	it("uses the document scroll when the content column has no independent overflow", async () => {
		const container = await mountModal();
		const outlineButton = container.querySelector<HTMLButtonElement>('[aria-label="Task sections"] [data-section="implementation-plan"]');
		const targetSection = container.querySelector<HTMLElement>('[data-task-section="implementation-plan"]');
		const scrollCalls: ScrollIntoViewOptions[] = [];
		const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: (options: ScrollIntoViewOptions) => scrollCalls.push(options),
		});
		try {
			expect(outlineButton).toBeTruthy();
			expect(targetSection).toBeTruthy();
			await click(outlineButton as HTMLButtonElement);
			expect(scrollCalls).toHaveLength(1);
			expect(scrollCalls[0]?.behavior).toBe("auto");
			expect(scrollCalls[0]?.block).toBe("start");
		} finally {
			if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
			else Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: undefined });
		}
	});
});
