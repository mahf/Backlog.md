import { describe, expect, it } from "bun:test";
import type { FSWatcher } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceQueryCache, type WorkspaceQueryCacheOptions } from "../server/workspace-query-cache.ts";

async function workspace(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "workspace-cache-"));
	await mkdir(join(root, "backlog", "tasks"), { recursive: true });
	await mkdir(join(root, "backlog", "evidence", "nested"), { recursive: true });
	await mkdir(join(root, "backlog", "workflow"), { recursive: true });
	await writeFile(join(root, "backlog", "tasks", "TASK-1.md"), "one", "utf8");
	await writeFile(join(root, "backlog", "evidence", "nested", "fact.txt"), "fact", "utf8");
	await writeFile(join(root, "backlog", "workflow", "approvals.jsonl"), "approval", "utf8");
	return root;
}

describe("WorkspaceQueryCache", () => {
	it("deduplicates concurrent cold misses", async () => {
		const root = await workspace();
		try {
			const cache = new WorkspaceQueryCache<number>();
			let loads = 0;
			const values = await Promise.all(
				Array.from({ length: 10 }, () =>
					cache.get(root, async () => {
						loads++;
						await new Promise((resolve) => setTimeout(resolve, 5));
						return 7;
					}),
				),
			);
			expect(loads).toBe(1);
			expect(values).toEqual(Array(10).fill(7));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("reloads only the root whose nested files changed", async () => {
		const rootA = await workspace();
		const rootB = await workspace();
		try {
			const cacheA = new WorkspaceQueryCache<number>();
			const cacheB = new WorkspaceQueryCache<number>();
			let loadsA = 0;
			let loadsB = 0;
			await cacheA.get(rootA, async () => ++loadsA);
			await cacheB.get(rootB, async () => ++loadsB);
			await writeFile(join(rootA, "backlog", "tasks", "TASK-1.md"), "task changed", "utf8");
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(await cacheA.get(rootA, async () => ++loadsA)).toBe(2);
			expect(await cacheB.get(rootB, async () => ++loadsB)).toBeGreaterThanOrEqual(1);
			await writeFile(join(rootA, "backlog", "evidence", "nested", "fact.txt"), "evidence changed", "utf8");
			expect(await cacheA.get(rootA, async () => ++loadsA)).toBe(3);
			await writeFile(join(rootA, "backlog", "workflow", "approvals.jsonl"), "ledger changed", "utf8");
			expect(await cacheA.get(rootA, async () => ++loadsA)).toBe(4);
			cacheA.clear();
			cacheB.clear();
		} finally {
			await rm(rootA, { recursive: true, force: true });
			await rm(rootB, { recursive: true, force: true });
		}
	});

	it("does not cache a load invalidated during or changed during the read", async () => {
		const root = await workspace();
		try {
			const cache = new WorkspaceQueryCache<number>();
			let loads = 0;
			let release!: () => void;
			const blocked = new Promise<void>((resolve) => {
				release = resolve;
			});
			const first = cache.get(root, async () => {
				await blocked;
				return ++loads;
			});
			cache.invalidate(root);
			release();
			expect(await first).toBe(1);
			expect(await cache.get(root, async () => ++loads)).toBe(2);

			cache.invalidate(root);
			let changeRelease!: () => void;
			const changeBlocked = new Promise<void>((resolve) => {
				changeRelease = resolve;
			});
			const changed = cache.get(root, async () => {
				changeRelease();
				return ++loads;
			});
			await changeBlocked;
			await writeFile(join(root, "backlog", "workflow", "approvals.jsonl"), "changed again", "utf8");
			expect(await changed).toBe(3);
			expect(await cache.get(root, async () => ++loads)).toBe(4);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rechecks scratch materials after the bounded cache TTL", async () => {
		const root = await workspace();
		try {
			await mkdir(join(root, ".scratch", "sessions"), { recursive: true });
			const session = join(root, ".scratch", "sessions", "agent.json");
			await writeFile(session, "old", "utf8");
			let now = 0;
			const cache = new WorkspaceQueryCache<number>({ ttlMs: 1000, now: () => now, watch: false });
			let loads = 0;
			await cache.get(root, async () => ++loads);
			await writeFile(session, "new", "utf8");
			now = 1001;
			expect(await cache.get(root, async () => ++loads)).toBe(2);
			expect(loads).toBe(2);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("reuses a healthy watcher snapshot past the TTL and audits outside get", async () => {
		const root = await workspace();
		try {
			let now = 0;
			let fingerprints = 0;
			const cache = new WorkspaceQueryCache<number>({
				ttlMs: 10,
				now: () => now,
				fingerprint: async () => {
					fingerprints++;
					return "stable";
				},
			});
			let loads = 0;
			await cache.get(root, async () => ++loads);
			const initialFingerprints = fingerprints;
			now = 100;
			expect(await cache.get(root, async () => ++loads)).toBe(1);
			expect(fingerprints).toBe(initialFingerprints);
			cache.dispose(root);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("reports watcher failures without treating missing optional directories as failures", async () => {
		const root = await workspace();
		try {
			let fail!: (error: Error) => void;
			const watchFactory = ((..._args: unknown[]) => {
				const watcher = {
					on(event: string, handler: (error: Error) => void) {
						if (event === "error") fail = handler;
						return watcher;
					},
					close() {},
				} as unknown as FSWatcher;
				return watcher;
			}) as unknown as WorkspaceQueryCacheOptions["watchFactory"];
			const cache = new WorkspaceQueryCache<number>({ watchFactory, fingerprint: async () => "stable" });
			await cache.get(root, async () => 1);
			expect(cache.warning(root)).toBeUndefined();
			fail(new Error("watch unavailable"));
			expect(cache.warning(root)).toBe("watch unavailable");
			cache.dispose(root);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("reports synchronous watch failures and clears warning only after recovery", async () => {
		const root = await workspace();
		try {
			let attempts = 0;
			const handles: FSWatcher[] = [];
			const watchFactory = ((..._args: unknown[]) => {
				attempts++;
				if (String(_args[0]).includes(".scratch")) {
					throw Object.assign(new Error("scratch directory is absent"), { code: "ENOENT" });
				}
				if (attempts === 1) {
					const error = Object.assign(new Error("recursive watch denied"), { code: "EACCES" });
					throw error;
				}
				const watcher = { on: () => watcher, close() {} } as unknown as FSWatcher;
				handles.push(watcher);
				return watcher;
			}) as unknown as WorkspaceQueryCacheOptions["watchFactory"];
			const cache = new WorkspaceQueryCache<number>({
				watchFactory,
				fingerprint: async () => "stable",
				maintenanceIntervalMs: 10,
			});
			await cache.get(root, async () => 1);
			expect(cache.warning(root)).toBe("recursive watch denied");
			await new Promise((resolve) => setTimeout(resolve, 25));
			expect(handles.length).toBe(1);
			expect(cache.warning(root)).toBeUndefined();
			cache.dispose(root);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("starts watching scratch directories created after the first read", async () => {
		const root = await workspace();
		try {
			const cache = new WorkspaceQueryCache<number>({
				maintenanceIntervalMs: 10,
				fingerprint: async () => "stable",
			});
			let loads = 0;
			await cache.get(root, async () => ++loads);
			await mkdir(join(root, ".scratch", "sessions"), { recursive: true });
			await mkdir(join(root, ".scratch", "artifacts"), { recursive: true });
			await new Promise((resolve) => setTimeout(resolve, 35));
			await writeFile(join(root, ".scratch", "sessions", "agent.json"), "new", "utf8");
			await new Promise((resolve) => setTimeout(resolve, 35));
			expect(await cache.get(root, async () => ++loads)).toBe(2);
			cache.dispose(root);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not resurrect an audit timer after dispose or clear during rejection", async () => {
		for (const cleanup of ["dispose", "clear"] as const) {
			const root = await workspace();
			try {
				let calls = 0;
				let started!: () => void;
				const auditStarted = new Promise<void>((resolve) => {
					started = resolve;
				});
				let rejectAudit!: (error: Error) => void;
				const cache = new WorkspaceQueryCache<number>({
					maintenanceIntervalMs: 10,
					fingerprint: async () => {
						calls++;
						if (calls === 3) {
							started();
							await new Promise<never>((_, reject) => {
								rejectAudit = reject;
							});
						}
						return "stable";
					},
				});
				await cache.get(root, async () => 1);
				await auditStarted;
				if (cleanup === "dispose") cache.dispose(root);
				else cache.clear();
				rejectAudit(new Error("audit stopped"));
				await new Promise((resolve) => setTimeout(resolve, 35));
				expect(calls).toBe(3);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		}
	});

	it("does not let an older promise settle a newer generation", async () => {
		const root = await workspace();
		try {
			const cache = new WorkspaceQueryCache<string>();
			let release!: () => void;
			const blocked = new Promise<void>((resolve) => {
				release = resolve;
			});
			const first = cache.get(root, async () => {
				await blocked;
				return "old";
			});
			cache.invalidate(root);
			release();
			expect(await first).toBe("old");
			expect(await cache.get(root, async () => "new")).toBe("new");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
