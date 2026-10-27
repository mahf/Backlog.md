import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiClient, type WorkspaceSummary } from "../lib/api";

export default function WorkspaceSwitcher() {
	const [searchParams, setSearchParams] = useSearchParams();
	const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
	const scope = searchParams.get("workspace") ?? "";

	useEffect(() => {
		const saved = window.localStorage.getItem("backlog.workspace") ?? "";
		if (!searchParams.has("workspace") && saved) {
			setSearchParams(
				(params) => {
					params.set("workspace", saved);
					return params;
				},
				{ replace: true },
			);
		}
	}, [searchParams, setSearchParams]);

	useEffect(() => {
		let active = true;
		apiClient
			.fetchWorkspaces()
			.then((entries) => {
				if (active) setWorkspaces(entries);
			})
			.catch(() => {
				if (active) setWorkspaces([]);
			});
		return () => {
			active = false;
		};
	}, []);

	if (workspaces.length === 0) return null;

	return (
		<label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
			<span className="sr-only">Directory project</span>
			<select
				aria-label="Directory project"
				value={scope}
				onChange={(event) => {
					const next = event.target.value;
					window.localStorage.setItem("backlog.workspace", next);
					setSearchParams(
						(params) => {
							if (next) params.set("workspace", next);
							else params.delete("workspace");
							params.delete("taskWorkspace");
							return params;
						},
						{ replace: false },
					);
				}}
				className="max-w-48 rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
			>
				<option value="">Current project</option>
				<option value="all">All directory projects</option>
				{workspaces.map((workspace) => (
					<option key={workspace.id} value={workspace.id} disabled={Boolean(workspace.error)}>
						{workspace.name}
						{workspace.writable ? "" : " (read-only)"}
						{workspace.error ? " (unavailable)" : ""}
					</option>
				))}
			</select>
		</label>
	);
}
