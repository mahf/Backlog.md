---
id: BACK-796
title: 迁移与兼容：统一 Backlog 原生任务并保留 workflow 历史
status: In Progress
assignee:
  - '@luna'
created_date: 2026-10-23 07:43
updated_date: '2026-10-26T04:09:00Z'
labels:
  - local-workbench
  - multi-root
  - workflow
dependencies:
  - BACK-789
  - BACK-790
references:
  - C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/USAGE.md
  - C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/REVIEW-UX.md
  - C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/BACKLOG-BRIDGE.md
priority: medium
ordinal: 406000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
现有 workflow 同时读取 backlog/tickets 自有票和 backlog/tasks 原生票。目标是以后以 Backlog 原生任务为主要任务载体，同时保留审批、证据和会话历史。先提供兼容和可预览的迁移，再考虑退役 rq 独立界面；不得移动后丢失任务身份或因 Done 状态生成有效批准。既有 BACKLOG-BRIDGE.md 的独立网页路线需在对接文档中说明已由此系列扩展路线取代。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 既有 tickets 与 tasks 可同时读取并显示来源；同一项目 ID 冲突明确拒绝歧义操作，不自动合并或复制影子票。
- [x] #2 提供公开 CLI 迁移预览，列出目标、身份映射、证据/审批/会话关联及冲突；预览不写文件，执行需明确目标与确认。
- [x] #3 迁移保留原记录和可恢复备份，重复执行可识别已迁移项；中断可恢复，不重复编号、不丢失历史或悄悄覆盖已有任务。
- [x] #4 历史 accepted/Done 保持历史事实，不补造审批、不批量重开；新交付按当前 workflow 策略核验。
- [x] #5 文档列出旧 rq 命令到新入口映射、普通目录使用方式及 OneDrive/多机并发限制；新版可用前旧入口保持可用。
- [x] #6 测试覆盖混合来源、重号、中文路径、材料与答复关联、中断/重复执行和回退；迁移演练后核对任务数量与权威记录。
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Inventory backlog/tickets and backlog/tasks with authoritative IDs, raw bytes, workflow associations, and strict root validation. 2. Produce deterministic read-only previews with mappings, conflicts, evidence/approval/session references, and fingerprints; reject unsupported prefixes and collisions. 3. Apply only with one explicit workspace, --confirm, and reviewed fingerprint using no-replace moves, external raw backups, durable journals, interruption recovery, and concurrent-safe rollback. 4. Register migration preview/apply/recover/rollback CLI, document rq mappings and filesystem limits, and verify isolated rehearsal, scoped tests, Biome, and TypeScript.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
协调者独立复验：显式真实 BACKLOG_RQ_PATH，workflow-migration 与 workspace-registry 两文件26通过0失败90断言；真实T-001 request经实际apply迁移后rq board/card可读，ledger不变，rollback恢复旧票；并发目标、publish-before-unlink、中断journal、重复回退测试通过。状态映射保留原文备份且不造审批。仍加强同身份 evidence/session 关联及数量核对，再进行最终验收。

协调者最新独立复验：真实rq下迁移与注册表27通过0失败97断言。匹配T-001 evidence/session、旧source_key、ledger字节、任务数、重复恢复/回退及自定义Shipped终态已覆盖。迁移功能验收条件已核验，保留In Progress等待最终共享构建与格式检查；未迁移真实项目。

2026-10-26 协调者独立复验：迁移/适配器/CLI/登记四文件 38 pass、143 assertions，显式真实 rq；原生 tsc 12:04 通过，相关10个 TypeScript 文件 Biome 通过。全部6项AC已有隔离证据；整仓Biome仍有已记录的未修改文件行尾/格式错误，DOD2保持未勾选。未提交、未迁移真实项目。
<!-- SECTION:NOTES:END -->
