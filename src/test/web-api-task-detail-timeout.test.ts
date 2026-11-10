import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { ApiClient } from "../web/lib/api.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("Web task detail API client", () => {
	it("waits up to 60 seconds without retrying and clears the timeout on failure", async () => {
		let calls = 0;
		globalThis.fetch = (async () => {
			calls += 1;
			throw new Error("connection closed");
		}) as unknown as typeof globalThis.fetch;
		const setTimeoutSpy = spyOn(globalThis, "setTimeout");
		const clearTimeoutSpy = spyOn(globalThis, "clearTimeout");

		try {
			const client = new ApiClient({ retries: 3 });
			await expect(client.fetchTask("TASK-1")).rejects.toThrow("Request failed after 1 attempts");

			expect(calls).toBe(1);
			expect(setTimeoutSpy.mock.calls[0]?.[1]).toBe(60000);
			expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
		} finally {
			setTimeoutSpy.mockRestore();
			clearTimeoutSpy.mockRestore();
		}
	});
});
