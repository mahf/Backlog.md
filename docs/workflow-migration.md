# Workflow migration

`backlog workflow migration preview --cwd <project> --json` reads `backlog/tickets` and
`backlog/tasks` without writing either directory. The preview reports each source, target,
original ID mapping, conflicts, and matching evidence, approval-ledger, and local-session
associations. A fingerprint identifies the exact reviewed file contents and mapping.

Apply only from one registered workspace:

```powershell
backlog workflow migration preview --workspace <id> --json
backlog workflow migration apply --workspace <id> --confirm --fingerprint <fingerprint>
backlog workflow migration recover <fingerprint> --workspace <id>
backlog workflow migration rollback <fingerprint> --workspace <id>
```

Apply preserves raw Markdown bytes and the original ID. It first creates a backup and durable
journal under `.backlog-workflow-migration/`, then uses no-replace moves into `backlog/tasks`;
legacy tickets lacking native frontmatter receive only the minimal native header needed for
Backlog parsing, while their complete original bytes remain in the backup.
Unsupported task prefixes and same-project identity collisions remain explicit conflicts. Legacy
statuses are normalized deterministically: configured native statuses win, then
`workflow/REVIEW-POLICY.md` `status_map.*` entries, then rq's standard vocabulary maps review
states to an active native status and accepted/human-approved states to the configured terminal
status. If no suitable native status exists, preview remains an explicit conflict. No IDs,
approvals, accepted/Done history, evidence, sessions, or ledger entries are manufactured,
rewritten, or reopened. Existing rq history is preserved byte-for-byte: rq uses `source_key` when
creating or replaying a request, but response/resume address the request ID and ticket identity.
After a legacy ticket is normalized with its original ID, `rq board` and `rq card` continue to find
the task while the historical request retains its old `source_key` as provenance. A source-type or
digest change can intentionally make an old request stale and expose the current blockers; do not
approve it automatically. Recovery resumes only unchanged pending records, including the safe
dual-side state left by a crash after target publication, and rollback refuses to overwrite a file
that appeared or changed after the migration.

The isolated rq 1.1.0 verification used `BACKLOG_RQ_PATH` and a temporary project: before the move,
`rq board --plain` reported `original_id: T-001` and a request with
`source_key: ticket:backlog/tickets/T-001-old.md`; after preserving `id: T-001` under
`backlog/tasks`, `rq board --plain` and `rq card T-001` still resolved the task and retained the
request record. Answering with the old revision was rejected with the real missing-evidence and
current-revision blockers, while `rq respond` did not create an approval. This confirms that the
migration preserves history and fails closed on stale evidence rather than claiming approval.

The automated integration test runs the public migration API and rq commands in a temporary
fixture when `BACKLOG_RQ_PATH` is explicitly set. It checks the request can be created before
migration, the exact approvals ledger bytes remain unchanged after apply, and post-migration
`rq board --plain` and `rq card` still resolve the original task ID.

The old rq commands remain available: use `rq board`, `rq inbox`, `rq card`, `rq request`,
`rq respond`, `rq review`, `rq accept`, `rq resume`, `rq ack`, and `rq rebuild` for workflow
operations. The migration command changes file placement only; rq remains authoritative for
approvals and request history.

This migration and the surrounding Backlog CLI workflow supersede the standalone webpage-only
integration route described by the original bridge proposal; the bridge remains the compatibility
contract for rq data and commands.

Normal filesystem directories work without Git. OneDrive synchronization and multi-machine
use do not provide distributed locking or consistency, so run preview and apply on one machine,
stop other writers, and rerun preview after any concurrent change.
