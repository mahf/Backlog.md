# Workspace Performance

Final incremental-cache rerun: `validation-workspace-benchmark-incremental-final.json` contains all three sizes, 100 tasks per root and five samples per size, measured after the healthy-watcher fast path, staggered audits and timer cleanup were added.

| Roots | Direct cold median/p95 ms | Production HTTP warm median/p95 ms | Natural visible median/p95 ms |
| ---: | ---: | ---: | ---: |
| 1 | 925.6 / 975.4 | 6.6 / 805.2 | 937.6 / 956.2 |
| 10 | 3160.4 / 3616.6 | 27.8 / 35.7 | 1111.5 / 1385.5 |
| 30 | 9539.2 / 13230.9 | 85.3 / 93.5 | 1215.9 / 1391.4 |

Every size completed with `status: measured`, `sampleCount: 5`, cold rq calls equal root count, warm calls zero and changed calls one. The HTTP material/respond samples are also complete. Public HTTP initial warm-up encountered long-running rq reads in two 10-root repeats and one 30-root repeat; bounded timeout and retry eventually recovered. This warm-up delay is outside the direct cold-cache metric above, so the cold column does not promise a bounded full HTTP startup time. Earlier measurements and the failed 180-second warm-up artifact remain below for comparison; the new results supersede earlier latency figures for the incremental-cache implementation. The OneDrive measurement below predates this final cache change and was not repeated.

`/api/workflow?allWorkspaces=true` keeps one immutable board result per registered root and reuses it until that root's recursive file watcher reports a change. With a healthy watcher, unchanged reads do not fingerprint after the 1-second TTL; each root instead runs one independently staggered audit every 30-60 seconds, which invalidates the snapshot on a missed event. The cache watches and audits `backlog`, `.scratch/sessions`, and `.scratch/artifacts`; retries reopen only missing or failed directory watchers on that same bounded cadence, while actual watcher failures expose a per-root fallback warning and use periodic fingerprint validation. Workflow mutations explicitly invalidate before checking the current request, so cached snapshots are never used as approval evidence. Workflow GETs accept `refresh=true` to invalidate only the requested root, or all registered roots for an aggregate request, before loading current data; normal polling leaves the cache intact.

Aggregate refreshes share one 2-second response deadline across all roots and return healthy roots while slower roots are marked `{ loading: true }`; repeat requests poll those in-flight snapshots. Unavailable roots remain per-root errors and do not hide healthy results. Removed roots and cached child contexts are disposed when the registry is re-read or the server stops.

Run the reproducible fixture benchmark with the real local rq adapter:

```text
$env:BACKLOG_RQ_PATH='C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/tools/rq.py'
$env:BACKLOG_BENCH_ROOTS='1,10,30'
$env:BACKLOG_BENCH_REPEATS='5'
bun scripts/workspace-benchmark.ts
```

The benchmark warms the public aggregate route until every root contributes all 100 tasks and no loading/error entries remain before timing the production HTTP warm metric. It uses an explicit `cache.refresh` for the direct cache microbenchmark after the fixture edit, validates the changed `TASK-1` title by `workspaceId=benchmark-0` plus `original_id`, asserts cold rq calls equal root count, warm calls equal zero, and changed calls equal one, then measures the public HTTP material and respond endpoints. Fetches and warm-up are bounded and progress is written to stderr; each completed repeat is persisted to the artifact path.

Completed validation samples on Windows 2026-10-26 with the configured rq adapter (five repeats each):

| Roots | Cold median/p95 ms | Direct cache warm median/p95 ms | Production HTTP warm median/p95 ms | Changed-to-visible median/p95 ms | Material median/p95 ms | Respond median/p95 ms | Natural visible median/p95 ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 992.6 / 1160.6 | 0.5 / 0.5 | 7.5 / 819.8 | 1099.3 / 1240.0 | 1042.2 / 1366.3 | 1636.4 / 2128.0 | 1053.3 / 1389.6 |
| 10 | 3365.1 / 4065.0 | 5.7 / 7.5 | 45.6 / 74.9 | 1221.7 / 1314.5 | 1292.9 / 1608.8 | 1730.2 / 1950.5 | 1117.1 / 1473.8 |
| 30 | 9025.2 / 9839.8 | 14.4 / 25.4 | 183.7 / 187.5 | 989.0 / 1228.6 | 973.4 / 1029.2 | 1303.8 / 1519.1 | 1214.4 / 1237.1 |

The corrected 1/10/30-root x5 runs completed with `sampleCount: 5`, and each asserts cold rq calls equal root count, immediate warm calls equal zero, changed calls equal one, 100 tasks per root, and the scoped `workspaceId=benchmark-0`, `original_id: TASK-1` title. The HTTP material and respond endpoints each have five real samples; natural watcher visibility is measured through the public aggregate route. The initial 30-root run exposed two indefinitely loading rq children; the adapter now limits read-only board processes to four concurrent children and returns a bounded timeout, after which the final 30-root run completed. The direct cache warm metric is intentionally separate from production HTTP warm. Acceptance targets are production aggregate warm p95 <= 1000ms and changed-to-visible p95 <= 2000ms; cold 30-root loading is measured but is not a failure criterion.

An isolated OneDrive-parent 1-root x5 run is recorded in `docs/validation-workspace-benchmark-onedrive-1x5.json`; its production aggregate warm p95 was 12.6ms and natural visible p95 was 1416.0ms. The fixture used a unique mkdtemp directory under the configured tools directory and was removed after the run; no real project ledger was read or changed.
