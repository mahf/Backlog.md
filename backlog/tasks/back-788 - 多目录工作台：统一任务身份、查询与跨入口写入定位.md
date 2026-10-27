---
id: BACK-788
title: 多目录工作台：统一任务身份、查询与跨入口写入定位
status: In Progress
assignee:
  - '@luna'
created_date: 2026-10-23 07:41
updated_date: '2026-10-26T04:09:00Z'
labels:
  - local-workbench
  - multi-root
dependencies:
  - BACK-787
references:
  - C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/USAGE.md
  - C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/REVIEW-UX.md
priority: high
ordinal: 398000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
多个项目常出现同名任务（例如 TASK-1），如果搜索、详情或更新只传任务号，会读取或覆盖错误项目。提供按目录级标识限定的共享查询与变更语义，由 CLI 定义规范，网页、TUI 和已支持的 MCP 适配器采用同一规则。每个项目继续使用自己的 Markdown、配置和任务编号分配器；工作台只聚合视图，不创建影子任务。目录级选择不能与 BACK-643 的任务 project 属性混淆。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 两个项目的同名任务可同时查询并有清楚的项目来源；机器输出、详情链接、事件和写入携带明确的目录级身份。
- [x] #2 有多个匹配目标时，缺少目录上下文的更新拒绝执行，不通过当前页面筛选、首个匹配或任意客户端路径猜测目标。
- [x] #3 新建、编辑、状态迁移、排序及生命周期操作遵循目标项目配置、编号锁和写权限；一个项目的设置不污染另一个。
- [x] #4 全部项目查询返回每项目局部错误和仍可用的数据；默认不增加跨项目依赖或统一里程碑语义。
- [x] #5 网页/TUI/CLI 以及存在对应操作的 MCP 遵守相同定位规则；深链接直接打开正确项目与任务，非法项目和越界材料路径被拒绝。
- [x] #6 测试覆盖重号、只读、项目切换、并发写入、目录消失和既有单项目命令；公开帮助说明目录上下文与任务分类的不同。
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Resolve explicit workspace identity through the registry and reject unknown or unavailable roots. 2. Route CLI project resolution through --workspace while preserving task --project categories and enforcing write permissions. 3. Add focused collision, read-only, missing-workspace, persistence, and help evidence. 4. Run scoped tests, type checking, formatting, and smoke checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented shared workspace-context resolution and CLI --workspace selection with fail-closed unknown/unavailable roots and read-only mutation guard; preserved task --project semantics. Evidence: bun test src/test/workspace-registry.test.ts (10 pass, 27 expects); bunx tsc --noEmit --pretty false (pass); bunx biome check on touched files (pass); bun scripts/build.ts (pass); bun src/cli.ts --help shows workspace distinction. HTTP/MCP/TUI aggregate views and --all-workspaces aggregation remain follow-up scope and were not claimed.

Corrective dispatch: removed argv regex write-guard bypass; explicit command classification now rejects read-only workspace writes even when title is 'view'. Implemented CLI task list --all-workspaces with per-root Core isolation, workspaceId rows, partial errors, and aggregate-write rejection; HTTP task listing supports allWorkspaces partial errors and workspaceId, create/edit validate target identity and permissions; MCP task tools expose workspaceId and reject unknown/foreign/read-only targets. Evidence: bun test src/test/workspace-registry.test.ts (12 pass, 33 expects), bun scripts/build.ts (pass), node node_modules/typescript/bin/tsc --noEmit reports only pre-existing/other-worker src/web/App.tsx SearchResult.score error; Biome unavailable due Windows EPERM and git diff --check reports unrelated src/web trailing whitespace. Remaining: true cross-root HTTP/MCP mutation execution and full UI/deep-link/event integration are not complete in this dispatch.

Further corrective work: added Core-level rechecked registry writable guard across task/draft/bulk/reorder/move/archive/delete/restore/demote writes; added GET /api/workspaces, GET /api/workspaces/tasks, query-selected independent GET /api/tasks routing, workspaceId projections, and MCP workspaceId schemas/validation; registered workflow CLI command. Real evidence: 3 targeted tests pass (read-only title bypass, duplicate aggregate query, explicit target), aggregate suite 12 pass/33 expects under 15s, bun scripts/build.ts pass. Full tsc now reports only subsequent worker src/test/web-workspace-switcher.test.tsx cast error; cross-root HTTP/MCP mutation execution beyond current server instance remains unfinished.

2026-10-26 协调者复核：真实编译版 all+b详情不再串local会话；all切a后实际网页失焦写入仅改a，b/local不变。独立25项HTTP/MCP/缓存/弹窗回归通过，含两目录外部编辑事件和重号详情Escape；登记/迁移/CLI组合38pass。材料普通文件200、批准目录403、外部符号链接403的HTTP回归worker7pass31assertions，待最终组合复验。原生tsc通过；整仓Biome失败已记录，保留DOD2未勾选。
<!-- SECTION:NOTES:END -->
