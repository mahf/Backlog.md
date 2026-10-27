import { type FSWatcher, watch } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { resolveBacklogDirectory } from "../utils/backlog-directory.ts";

const AUDIT_INTERVAL_MS = 30_000;

export type CachedWorkspaceSnapshot<T> = {
	value: T;
	fingerprint: string;
};

type Entry<T> = CachedWorkspaceSnapshot<T> & { generation: number; checkedAt: number; inFlight?: Promise<T> };

function errorCode(error: unknown): string | undefined {
	return error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : undefined;
}

export type WorkspaceQueryCacheOptions = {
	ttlMs?: number;
	now?: () => number;
	watch?: boolean;
	watchFactory?: typeof watch;
	fingerprint?: (root: string) => Promise<string>;
	maintenanceIntervalMs?: number;
};

// Directory mtimes miss nested edits; per-file metadata keeps the fallback correct without watchers.
async function fingerprint(root: string): Promise<string> {
	const files: string[] = [];
	const directories = [
		resolveBacklogDirectory(root).backlogPath ?? join(root, "backlog"),
		join(root, ".scratch", "sessions"),
		join(root, ".scratch", "artifacts"),
	];
	const visit = async (directory: string): Promise<void> => {
		let entries: Array<{ name: string; isDirectory(): boolean }>;
		try {
			entries = await readdir(directory, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) await visit(path);
			else files.push(path);
		}
	};
	for (const directory of directories) await visit(directory);
	files.sort();
	const values = await Promise.all(
		files.map(async (path) => {
			try {
				const info = await lstat(path);
				return `${relative(root, path)}:${info.mtimeMs}:${info.size}:${info.mode}`;
			} catch {
				return `${relative(root, path)}:missing`;
			}
		}),
	);
	return values.join("|");
}

export class WorkspaceQueryCache<T> {
	private readonly entries = new Map<string, Entry<T>>();
	private readonly generations = new Map<string, number>();
	private readonly watchers = new Map<string, FSWatcher[]>();
	private readonly watchedDirectories = new Map<string, Set<string>>();
	private readonly watchFailures = new Map<string, string>();
	private readonly auditTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly ttlMs: number;
	private readonly now: () => number;
	private readonly enableWatchers: boolean;
	private readonly createWatcher: typeof watch;
	private readonly getFingerprint: (root: string) => Promise<string>;
	private readonly maintenanceIntervalMs: number;

	constructor(options: WorkspaceQueryCacheOptions = {}) {
		this.ttlMs = options.ttlMs ?? 1_000;
		this.now = options.now ?? Date.now;
		this.enableWatchers = options.watch ?? true;
		this.createWatcher = options.watchFactory ?? watch;
		this.getFingerprint = options.fingerprint ?? fingerprint;
		this.maintenanceIntervalMs = Math.max(1, options.maintenanceIntervalMs ?? AUDIT_INTERVAL_MS);
	}

	private generation(root: string): number {
		return this.generations.get(root) ?? 0;
	}

	private ensureWatcher(root: string, retry = false): void {
		if (this.watchFailures.has(root) && !retry) return;
		const opened = this.watchers.get(root) ?? [];
		const watched = this.watchedDirectories.get(root) ?? new Set<string>();
		let hadRealFailure = false;
		try {
			const onWatchEvent = () => this.invalidate(root);
			const directories = [
				{ path: resolveBacklogDirectory(root).backlogPath ?? join(root, "backlog"), optional: false },
				{ path: join(root, ".scratch", "sessions"), optional: true },
				{ path: join(root, ".scratch", "artifacts"), optional: true },
			];
			for (const directory of directories) {
				if (watched.has(directory.path)) continue;
				try {
					const watcher = this.createWatcher(directory.path, { recursive: true }, onWatchEvent);
					watcher.on("error", (error) => {
						watcher.close();
						this.watchFailures.set(root, error instanceof Error ? error.message : String(error));
						watched.delete(directory.path);
						const current = this.watchers.get(root) ?? [];
						const remaining = current.filter((openedWatcher) => openedWatcher !== watcher);
						if (remaining.length > 0) this.watchers.set(root, remaining);
						else this.watchers.delete(root);
						this.invalidate(root);
						this.scheduleWatchRetry(root);
					});
					opened.push(watcher);
					watched.add(directory.path);
				} catch (error) {
					if (!directory.optional || errorCode(error) !== "ENOENT") {
						hadRealFailure = true;
						this.watchFailures.set(root, error instanceof Error ? error.message : String(error));
					}
				}
			}
			if (opened.length > 0) this.watchers.set(root, opened);
			this.watchedDirectories.set(root, watched);
			if (watched.size < directories.length) this.scheduleWatchRetry(root);
			if (
				!hadRealFailure &&
				directories.filter((directory) => !directory.optional).every((directory) => watched.has(directory.path))
			)
				this.watchFailures.delete(root);
		} catch (error) {
			this.watchFailures.set(root, error instanceof Error ? error.message : String(error));
			this.scheduleWatchRetry(root);
		}
	}

	private scheduleWatchRetry(root: string): void {
		if (this.retryTimers.has(root)) return;
		const timer = setTimeout(() => {
			this.retryTimers.delete(root);
			this.ensureWatcher(root, true);
		}, this.maintenanceIntervalMs);
		timer.unref?.();
		this.retryTimers.set(root, timer);
	}

	private auditDelay(root: string): number {
		let hash = 0;
		for (const character of root) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
		return this.maintenanceIntervalMs + (hash % this.maintenanceIntervalMs);
	}

	private scheduleAudit(root: string): void {
		if (this.auditTimers.has(root)) return;
		const timer = setTimeout(async () => {
			this.auditTimers.delete(root);
			const existing = this.entries.get(root);
			if (!existing || existing.inFlight) return;
			const generation = this.generation(root);
			try {
				const current = await this.getFingerprint(root);
				if (this.entries.get(root) !== existing || this.generation(root) !== generation) return;
				if (current !== existing.fingerprint) this.invalidate(root);
				else {
					this.entries.set(root, { ...existing, checkedAt: this.now() });
					this.scheduleAudit(root);
				}
			} catch {
				if (this.entries.get(root) === existing && this.generation(root) === generation) this.scheduleAudit(root);
			}
		}, this.auditDelay(root));
		timer.unref?.();
		this.auditTimers.set(root, timer);
	}

	async get(root: string, loader: () => Promise<T>): Promise<T> {
		if (this.enableWatchers) this.ensureWatcher(root);
		const currentGeneration = this.generation(root);
		const existing = this.entries.get(root);
		if (existing?.inFlight && existing.generation === currentGeneration) return existing.inFlight;
		if (
			existing &&
			!existing.inFlight &&
			this.enableWatchers &&
			this.watchers.has(root) &&
			!this.watchFailures.has(root) &&
			existing.generation === currentGeneration
		)
			return existing.value;
		if (
			existing &&
			!existing.inFlight &&
			!this.watchFailures.has(root) &&
			existing.generation === currentGeneration &&
			this.now() - existing.checkedAt < this.ttlMs
		)
			return existing.value;
		const previous = existing;
		const entry: Entry<T> = {
			fingerprint: "",
			value: previous?.value as T,
			generation: currentGeneration,
			checkedAt: this.now(),
		};
		const inFlight = (async () => {
			const before = await this.getFingerprint(root);
			if (previous && before === previous.fingerprint && this.generation(root) === currentGeneration) {
				if (this.entries.get(root) === entry) {
					this.entries.set(root, { ...previous, generation: currentGeneration, checkedAt: this.now() });
					if (this.enableWatchers && this.watchers.has(root) && !this.watchFailures.has(root)) this.scheduleAudit(root);
				}
				return previous.value;
			}
			const value = await loader();
			const after = await this.getFingerprint(root);
			if (this.entries.get(root) !== entry) return value;
			if (this.generation(root) === currentGeneration && before === after) {
				this.entries.set(root, { value, fingerprint: after, generation: currentGeneration, checkedAt: this.now() });
				if (this.enableWatchers && this.watchers.has(root) && !this.watchFailures.has(root)) this.scheduleAudit(root);
			} else if (this.generation(root) === currentGeneration) {
				this.entries.delete(root);
			}
			return value;
		})();
		entry.inFlight = inFlight;
		this.entries.set(root, entry);
		try {
			return await inFlight;
		} catch (error) {
			if (this.entries.get(root) === entry && this.generation(root) === currentGeneration) this.entries.delete(root);
			throw error;
		}
	}

	invalidate(root: string): void {
		this.generations.set(root, this.generation(root) + 1);
		this.entries.delete(root);
	}

	refresh(root: string): void {
		this.invalidate(root);
	}

	warning(root: string): string | undefined {
		return this.watchFailures.get(root);
	}

	dispose(root: string): void {
		this.invalidate(root);
		const auditTimer = this.auditTimers.get(root);
		if (auditTimer) clearTimeout(auditTimer);
		this.auditTimers.delete(root);
		const retryTimer = this.retryTimers.get(root);
		if (retryTimer) clearTimeout(retryTimer);
		this.retryTimers.delete(root);
		for (const watcher of this.watchers.get(root) ?? []) watcher.close();
		this.watchers.delete(root);
		this.watchedDirectories.delete(root);
		this.watchFailures.delete(root);
	}

	clear(): void {
		for (const root of new Set([
			...this.entries.keys(),
			...this.watchers.keys(),
			...this.auditTimers.keys(),
			...this.retryTimers.keys(),
		])) {
			this.invalidate(root);
			const auditTimer = this.auditTimers.get(root);
			if (auditTimer) clearTimeout(auditTimer);
			const retryTimer = this.retryTimers.get(root);
			if (retryTimer) clearTimeout(retryTimer);
			for (const watcher of this.watchers.get(root) ?? []) watcher.close();
		}
		this.entries.clear();
		this.watchers.clear();
		this.watchedDirectories.clear();
		this.watchFailures.clear();
		this.auditTimers.clear();
		this.retryTimers.clear();
	}
}
