import { Outlet } from "react-router-dom";
import type { DuplicateRepairPlan } from "../../core/duplicate-task-repair";
import type { Decision, Document, Task } from "../../types";
import { DuplicateIdWarning } from "./DuplicateIdWarning";
import { HealthIndicator, HealthSuccessToast } from "./HealthIndicator";
import Navigation from "./Navigation";
import SideNavigation from "./SideNavigation";

interface LayoutProps {
	projectName: string;
	showSuccessToast: boolean;
	onDismissToast: () => void;
	tasks: Task[];
	docs: Document[];
	decisions: Decision[];
	isLoading: boolean;
	loadingMessage?: string | null;
	error?: Error | null;
	onRefreshData: () => Promise<void>;
	duplicateRepairPlan?: DuplicateRepairPlan | null;
	workspaceErrors?: Array<{ workspaceId: string; error: string }>;
}

export default function Layout({
	projectName,
	showSuccessToast,
	onDismissToast,
	tasks,
	docs,
	decisions,
	isLoading,
	loadingMessage,
	error,
	onRefreshData,
	duplicateRepairPlan = null,
	workspaceErrors = [],
}: LayoutProps) {
	return (
		<div className="h-screen bg-gray-50 dark:bg-gray-900 flex overflow-hidden transition-colors duration-200">
			<HealthIndicator />
			<SideNavigation
				taskCount={tasks.length}
				docs={docs}
				decisions={decisions}
				isLoading={isLoading}
				error={error}
				onRetry={onRefreshData}
				onRefreshData={onRefreshData}
			/>
			<div className="flex-1 flex flex-col min-h-0 min-w-0">
				<Navigation projectName={projectName} loadingMessage={loadingMessage} />
				<DuplicateIdWarning plan={duplicateRepairPlan} onRepaired={onRefreshData} />
				{workspaceErrors.length > 0 && (
					<div
						role="alert"
						className="mx-4 mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
					>
						{workspaceErrors.map(({ workspaceId, error }) => (
							<div key={workspaceId}>
								{workspaceId}: {error}
							</div>
						))}
					</div>
				)}
				<main className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden">
					<Outlet context={{ tasks, docs, decisions, isLoading, onRefreshData }} />
				</main>
			</div>
			{showSuccessToast && <HealthSuccessToast onDismiss={onDismissToast} />}
		</div>
	);
}
