import type { ChangeEvent } from "react";

export type WorkflowAssertion = {
	id?: string;
	text?: string;
	result?: string;
};

export type WorkflowManualCase = {
	id?: string;
	assertion?: string;
	pre?: string;
	step?: string;
	op?: string;
	expect?: string;
	actual?: string;
};

export type WorkflowRequestChecksProps = {
	assertions?: WorkflowAssertion[];
	evidence?: Record<string, unknown>;
	manualCases?: WorkflowManualCase[];
	checks: Record<string, boolean>;
	observations: Record<string, string>;
	onCheckChange: (caseId: string, checked: boolean) => void;
	onObservationChange: (caseId: string, value: string) => void;
	disabled?: boolean;
};

function display(value: unknown): string {
	if (value === null || value === undefined || value === "") return "-";
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
	return JSON.stringify(value);
}

function caseId(item: WorkflowManualCase, index: number): string {
	return item.id?.trim() || `case-${index + 1}`;
}

function machineResult(result: string | undefined): string {
	return result?.trim() || "unknown";
}

export default function WorkflowRequestChecks({
	assertions = [],
	evidence = {},
	manualCases = [],
	checks,
	observations,
	onCheckChange,
	onObservationChange,
	disabled = false,
}: WorkflowRequestChecksProps) {
	return (
		<div className="space-y-4">
			<section aria-labelledby="workflow-assertions-heading" className="space-y-2">
				<h3 id="workflow-assertions-heading" className="font-semibold text-gray-900 dark:text-gray-100">
					Machine assertions
				</h3>
				{assertions.length > 0 ? (
					<div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-700">
						<table className="min-w-full text-left text-sm">
							<thead className="border-b border-gray-200 text-xs uppercase text-gray-500 dark:border-gray-700 dark:text-gray-400">
								<tr>
									<th className="px-3 py-2">ID</th>
									<th className="px-3 py-2">Assertion</th>
									<th className="px-3 py-2">Result</th>
								</tr>
							</thead>
							<tbody>
								{assertions.map((item, index) => (
									<tr
										key={item.id || `assertion-${index}`}
										className="border-b border-gray-100 last:border-0 dark:border-gray-800"
									>
										<td className="px-3 py-2 font-mono">{display(item.id)}</td>
										<td className="px-3 py-2">{display(item.text)}</td>
										<td className="px-3 py-2 font-mono">{machineResult(item.result)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<div className="text-sm text-gray-500">-</div>
				)}
			</section>

			<section aria-labelledby="workflow-evidence-heading" className="space-y-2">
				<h3 id="workflow-evidence-heading" className="font-semibold text-gray-900 dark:text-gray-100">
					Machine evidence
				</h3>
				<div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-700">
					<table className="min-w-full text-left text-sm">
						<tbody>
							{Object.entries(evidence).map(([key, value]) => (
								<tr key={key} className="border-b border-gray-100 last:border-0 dark:border-gray-800">
									<th scope="row" className="px-3 py-2 font-medium">
										{key}
									</th>
									<td className="px-3 py-2 font-mono">{display(value)}</td>
								</tr>
							))}
							{Object.keys(evidence).length === 0 && (
								<tr>
									<td className="px-3 py-2 text-sm text-gray-500">-</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</section>

			<section aria-labelledby="workflow-human-checks-heading" className="space-y-2">
				<h3 id="workflow-human-checks-heading" className="font-semibold text-gray-900 dark:text-gray-100">
					Human checks
				</h3>
				{manualCases.length > 0 ? (
					<div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-700">
						<table className="min-w-full text-left text-sm">
							<thead className="border-b border-gray-200 text-xs uppercase text-gray-500 dark:border-gray-700 dark:text-gray-400">
								<tr>
									<th className="px-3 py-2">Pass</th>
									<th className="px-3 py-2">Case</th>
									<th className="px-3 py-2">Assertion</th>
									<th className="px-3 py-2">Precondition</th>
									<th className="px-3 py-2">Step / operation</th>
									<th className="px-3 py-2">Expected</th>
									<th className="px-3 py-2">Actual</th>
									<th className="px-3 py-2">Failure observation</th>
								</tr>
							</thead>
							<tbody>
								{manualCases.map((item, index) => {
									const id = caseId(item, index);
									const checkId = id;
									const labelId = `workflow-check-${checkId}`;
									const onObservation = (event: ChangeEvent<HTMLTextAreaElement>) =>
										onObservationChange(checkId, event.target.value);
									return (
										<tr key={checkId} className="border-b border-gray-100 align-top last:border-0 dark:border-gray-800">
											<td className="px-3 py-2">
												<input
													id={labelId}
													type="checkbox"
													checked={checks[checkId] === true}
													disabled={disabled}
													onChange={(event) => onCheckChange(checkId, event.target.checked)}
												/>
												<label className="sr-only" htmlFor={labelId}>
													Pass {checkId}
												</label>
											</td>
											<td className="px-3 py-2 font-mono">{id}</td>
											<td className="px-3 py-2">{display(item.assertion)}</td>
											<td className="px-3 py-2">{display(item.pre)}</td>
											<td className="px-3 py-2">{[item.step, item.op].filter(Boolean).join(" / ") || "-"}</td>
											<td className="px-3 py-2">{display(item.expect)}</td>
											<td className="px-3 py-2">{display(item.actual)}</td>
											<td className="px-3 py-2">
												<label className="sr-only" htmlFor={`${labelId}-observation`}>
													Failure observation for {checkId}
												</label>
												<textarea
													id={`${labelId}-observation`}
													value={observations[checkId] ?? ""}
													disabled={disabled}
													onChange={onObservation}
													rows={2}
													className="w-48 rounded border border-gray-300 bg-transparent px-2 py-1 text-sm dark:border-gray-600"
												/>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				) : (
					<div className="text-sm text-gray-500">-</div>
				)}
			</section>
		</div>
	);
}
