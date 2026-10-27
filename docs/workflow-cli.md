# Workflow CLI

`backlog workflow` is the canonical Backlog entry point for the existing `rq` workflow. It invokes the configured public `rq` CLI and keeps `backlog/decisions/approvals.jsonl` as the authority; native task status, Markdown checkboxes, and derived snapshots never become approvals.

Use `backlog workflow status` to distinguish disabled, unavailable, and ready integration. Read-only commands are `inbox`, `card <ticket>`, and `board`; request and response commands are `request`, `respond`, `cancel`, `review`, `decide`, and `accept`. Add `--json` for stable wrapper output, and `--workspace <id>` to select a registered project explicitly; `BACKLOG_CWD` controls normal root discovery.

Configure an individual project with `backlog workflow config --enabled true --rq-path <rq.py> --python-path <python>`. An absent or disabled workflow leaves ordinary Backlog task commands available, while an enabled unavailable adapter fails with a concrete error.

The adapter forwards rq's business errors, revision conflicts, idempotent replay messages, and projection-pending outcomes without pretending that a failed projection or unavailable adapter succeeded. Disable integration through `backlog workflow config --enabled false`; projects without rq remain usable through the native Backlog commands.

Use `resume <requestId>` to retry delivery to the original bound session and `rebuild <target>` to repair projections from the ledger. `ack <requestId>` records explicit progress with rq's session and claim credentials; consult its help before use. A saved response, accepted transport, explicit receipt, running execution, and completion are separate facts. Missing signals remain unknown; resuming does not create a new agent.

Options may appear on the root command, `workflow`, or the action: `backlog --workspace local workflow config --json`, `backlog workflow --workspace local config --json`, and `backlog workflow config --workspace local --json` select the same registered directory. Aggregate workflow mutations require one explicit target instead.

The current rq `accept` command checks a milestone or the whole project and skips historical accepted records. It is not a task-scoped fresh-delivery authorization API. The completion-gate integration remains under acceptance review; do not interpret native Done or a project-level exit code as proof that a newly edited historical delivery has current approval.

When workflow is enabled, a new terminal task must already have one unique `backlog-task` entry
in the public `rq board --plain` snapshot; create it in a non-terminal status first. An update
that changes delivery material and enters a terminal status is rejected so the material can be
saved and reviewed before acceptance. Metadata-only edits and reopening historical terminal tasks
remain available, while stale approvals and request revision conflicts continue to be rejected by
the public rq command. The gate uses rq's project or `--milestone` acceptance scope and does not
invent a task-scoped approval API.
