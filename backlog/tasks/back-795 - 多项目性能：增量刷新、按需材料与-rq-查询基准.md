---
id: BACK-795
title: 多项目性能：增量刷新、按需材料与 rq 查询基准
status: In Progress
assignee:
  - '@luna'
created_date: 2026-10-23 07:42
updated_date: '2026-10-26T05:05:00Z'
labels:
  - local-workbench
  - multi-root
  - workflow
dependencies:
  - BACK-788
  - BACK-789
references:
  - C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/USAGE.md
  - C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/REVIEW-UX.md
priority: high
ordinal: 405000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
用户已反馈 rq 慢；聚合多个目录会放大每次启动进程、全量扫描和证据重算的成本。保留完整 workflow 校验，在 Backlog 中提供及时且不干扰编辑的更新。当前 rq 看板约 5 秒轮询且服务端默认缓存约 1 秒，属于需验证的风险点，不作为已证实根因。先记录实际启动、任务查询、证据计算、材料读取和呈现耗时，再以同一数据集验证改进。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 提供可复现基准和结果：1/10/30 个项目、每项目 100 个任务，分别测冷启动、热查询、单文件变化、材料展开与答复提交；记录环境、重复次数及中位/p95，基准不计首次安装依赖。
- [x] #2 无变化的重复查询不重新扫描所有项目或启动逐任务 rq 子进程；单项目变化只失效关联缓存/数据，未展开材料按需读取。
- [x] #3 在基准环境上热聚合查询 p95 不超过 1 秒，单项目文件变化到可见 p95 不超过 2 秒；如达不到，保留真实数据并收敛范围，不通过跳过校验宣称通过。
- [x] #4 审批提交校验最新请求和材料版本，派生缓存不充当批准依据；故障及监听失效有可见状态与可恢复刷新路径。
- [x] #5 慢/不可访问项目不串行阻塞可用项目展示；首次结果可分批出现并明确尚在加载范围，不把未加载当作零任务。
- [x] #6 后台更新不覆盖草稿或抢焦点；文件监听、连接及后台进程随项目移除/服务停止清理，不持续增长。
- [x] #7 基准覆盖普通目录及 Windows 路径；对 OneDrive 单独记录实际表现与限制，不承诺跨机器锁或分布式一致性。
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Add per-workspace workflow snapshot caching with bounded aggregate concurrency, watcher-style invalidation through root fingerprinting, and an isolated benchmark; preserve authoritative mutation reads and explicit unavailable benchmark results.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented server workflow cache integration, bounded aggregate reads, cache invalidation and cleanup, isolated 1/10/30-root benchmark, environment-gated rq integration, and canonical /workflow SPA deep links. Evidence: bun test --timeout=10000 src/test/server-workspace-routing.test.ts passed 4 with 1 rq integration skipped because BACKLOG_RQ_PATH is unset; benchmark executed and reported unavailable rq measurements for all root counts. Native tsc.exe and biome.exe could not launch due Windows EPERM.

最终增量基准 docs/validation-workspace-benchmark-incremental-final.json：1/10/30 项目各100任务、各5次完整样本；30项目热HTTP p95 93.5ms、自然变化可见p95 1391.4ms。健康监听读路径超过TTL不重新扫描，按根错开30-60秒后台审计；单根失效、无watch TTL、晚建scratch监听和dispose/clear期间审计拒绝均通过独立回归。预热中真实rq长查询超时后恢复，等待不计direct cold，不掩盖冷启动限制；OneDrive旧样本保留且未重跑。监听故障提示与显式刷新正在最终复核，AC4暂不勾选。整仓Biome仍未通过，不转Done。

13:05 AC4补齐并独立复验：同步/异步监听失败显示fallback warning，optional ENOENT正常，恢复后清提示且保留健康watcher；手动Refresh通过refresh=true失效选中范围，后台轮询仍命中缓存。当前/指定/all范围明确区分。最终cache/web/HTTP恢复39通过115断言，构建、tsc、限定格式通过。全仓Biome DOD2未通过，保持In Progress。
<!-- SECTION:NOTES:END -->
