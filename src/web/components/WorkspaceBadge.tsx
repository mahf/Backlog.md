import type { Task } from "../../types";

export default function WorkspaceBadge({ task }: { task: Task }) {
	const workspaceId = (task as Task & { workspaceId?: string }).workspaceId;
	if (!workspaceId) return null;
	return (
		<span
			className="inline-flex max-w-full items-center rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold leading-4 text-sky-700 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-200"
			title="Directory project"
		>
			{workspaceId}
		</span>
	);
}
