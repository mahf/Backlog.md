# Workflow E2E Evidence

`src/test/workflow-cli-e2e.test.ts` is the isolated canonical CLI evidence path for
the configured public `rq` engine. It runs `bun src/cli.ts` subprocesses against a
temporary project, lets Backlog allocate the task ID with the `T` prefix, uses an
unborn temporary Git repository for rq's supported snapshot baseline, and removes
the root after the test. It never touches a real project or approval ledger.

Run the integration explicitly with the real engine:

```powershell
$env:BACKLOG_RQ_PATH='C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/tools/rq.py'
bun test src/test/workflow-cli-e2e.test.ts --timeout 120000
```

The test declares a 120-second per-test budget because the native rq/python
projection can take longer than Bun's default; every individual subprocess is
still bounded at 20 seconds and killed on timeout.

The test proves public request, response, idempotent replay, evidence/check
generation, review approval, material-change staleness, stale-response rejection,
evidence refresh, re-review, and the final native task transition through the
existing workflow gate. It does not claim a running Agent session: without a bound
session, durable save/resume transport facts remain unknown and are covered by
transport-focused tests.

`rq accept` is public G4 acceptance with whole-project or `--milestone` scope. It
is not a task-scoped approval API and it skips historical accepted records. The
test therefore uses the existing gate's public project acceptance semantics and
does not fabricate a task approval, reopen history, or infer approval from native
`Done` status.

If the external engine rejects a step, the test reports the exact command, stdout,
and stderr and leaves the assertion in place; an unset `BACKLOG_RQ_PATH` produces a
clear skipped integration rather than pretending that the E2E ran.
