export type WorkflowCommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

export type WorkflowRunner = (argv: string[], cwd: string) => Promise<WorkflowCommandResult>;

export type WorkflowOptions = {
	root: string;
	rq?: string;
	pythonPath?: string;
	enabled?: boolean;
	runner?: WorkflowRunner;
};

function readBoardTimeoutMs(): number {
	const configured = Number(process.env.BACKLOG_WORKFLOW_READ_TIMEOUT_MS || "60000");
	return Number.isFinite(configured) ? Math.max(5_000, configured) : 60_000;
}
let activeReadBoards = 0;
const queuedReadBoards: Array<() => void> = [];

async function withReadBoardSlot<T>(operation: () => Promise<T>): Promise<T> {
	if (activeReadBoards >= 4) {
		await new Promise<void>((resolve) => queuedReadBoards.push(resolve));
	} else activeReadBoards++;
	try {
		return await operation();
	} finally {
		const next = queuedReadBoards.shift();
		if (next) next();
		else activeReadBoards--;
	}
}

function configuredCommand(options: WorkflowOptions): string[] | undefined {
	const command = options.rq?.trim() || process.env.BACKLOG_RQ_PATH?.trim() || "rq";
	if (!command) return undefined;
	if (command.toLowerCase().endsWith(".py"))
		return [
			options.pythonPath?.trim() || process.env.BACKLOG_RQ_PYTHON?.trim() || "python",
			"-X",
			"utf8",
			"-B",
			command,
		];
	return [command];
}

const defaultRunner = async (argv: string[], cwd: string, isReadOnlyBoard: boolean): Promise<WorkflowCommandResult> => {
	const processHandle = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe" });
	const output = Promise.all([
		new Response(processHandle.stdout).text(),
		new Response(processHandle.stderr).text(),
		processHandle.exited,
	]);
	if (!isReadOnlyBoard) {
		const [stdout, stderr, exitCode] = await output;
		return { exitCode, stdout, stderr };
	}
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		const [stdout, stderr, exitCode] = await Promise.race([
			output,
			new Promise<never>((_, reject) => {
				timeout = setTimeout(() => reject(new Error("Read-only workflow board timed out.")), readBoardTimeoutMs());
			}),
		]);
		return { exitCode, stdout, stderr };
	} catch (error) {
		if (process.platform === "win32") {
			const killer = Bun.spawn(["taskkill", "/pid", String(processHandle.pid), "/t", "/f"], {
				stdout: "ignore",
				stderr: "ignore",
			});
			await Promise.race([killer.exited, new Promise((resolve) => setTimeout(resolve, 1_000))]);
		} else processHandle.kill();
		await Promise.race([
			output.then(
				() => undefined,
				() => undefined,
			),
			new Promise((resolve) => setTimeout(resolve, 1_000)),
		]);
		return { exitCode: 124, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
	} finally {
		if (timeout) clearTimeout(timeout);
	}
};

export async function runWorkflow(args: string[], options: WorkflowOptions): Promise<WorkflowCommandResult> {
	if (options.enabled === false) {
		return { exitCode: 2, stdout: "", stderr: "Workflow integration is disabled for this project." };
	}
	const command = configuredCommand(options);
	if (!command) return { exitCode: 2, stdout: "", stderr: "Workflow integration is not configured." };
	try {
		const readOnlyBoard = args[0] === "board" && args[1] === "--plain";
		const argv = [...command, "--root", options.root, ...args];
		const operation = () =>
			options.runner ? options.runner(argv, options.root) : defaultRunner(argv, options.root, readOnlyBoard);
		return readOnlyBoard ? await withReadBoardSlot(operation) : await operation();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { exitCode: 127, stdout: "", stderr: `Workflow adapter unavailable: ${message}` };
	}
}

export async function workflowAvailability(options: WorkflowOptions): Promise<{
	enabled: boolean;
	available: boolean;
	message: string;
}> {
	if (options.enabled === false)
		return { enabled: false, available: false, message: "Workflow integration is disabled." };
	const result = await runWorkflow(["board", "--plain"], options);
	if (result.exitCode === 0) return { enabled: true, available: true, message: "Workflow adapter is ready." };
	return {
		enabled: true,
		available: false,
		message: (result.stderr || result.stdout || `rq exited with code ${result.exitCode}`).trim(),
	};
}

export async function workflowSnapshot(options: WorkflowOptions): Promise<WorkflowCommandResult> {
	return runWorkflow(["board", "--plain"], options);
}
