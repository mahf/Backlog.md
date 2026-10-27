---
id: BACK-790
title: Workflow 门禁：统一保护完成、材料变更与其他变更入口
status: In Progress
assignee:
  - '@luna'
created_date: 2026-10-23 07:41
updated_date: '2026-10-26T04:23:00Z'
labels:
  - local-workbench
  - multi-root
  - workflow
dependencies:
  - BACK-789
references:
  - C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/USAGE.md
  - C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/REVIEW-UX.md
priority: high
ordinal: 400000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
现有兼容映射包含 Backlog Done 到 workflow accepted，但任务进度不能代表当前交付有有效审批。扩展后应在共享语义中约束受 workflow 管理的交付，避免网页拖动、终端、CLI、MCP、批量或生命周期操作绕过审查与里程碑 G4（现有 workflow 的交付验收门禁）。普通项目和低风险任务按项目策略执行，不给所有任务强加人工审批。直接改 Markdown 无法完全阻止，因此读取时也不能把任务状态或清单勾选解释为授权。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 受管理任务转入完成时检查项目有效策略、当前交付证据和必要裁决；批准绑定所见版本，材料变化后旧批准不可继续放行。
- [x] #2 网页拖动、任务编辑、TUI、CLI、MCP 及批量更新的同等完成操作给出一致结果；归档、清理、恢复也不能制造有效批准或隐藏未解决请求。
- [x] #3 直接将文件改为 Done 或修改 Checkbox 后，工作台仍区分票面完成与有效验收，并提供可操作的恢复说明；历史 Done 不被伪造批准或批量重开。
- [x] #4 审查期间编辑及审查后关键材料改变执行一致的版本冲突/重新核对规则；冲突不覆盖用户新内容或丢失已保存答复。
- [x] #5 workflow 未启用时现有状态操作不受影响；低风险路径不额外启动独立 Agent 或强制人工环节。
- [x] #6 测试涵盖各公开写入口、旧版本批准、文件直接修改、批量部分失败、并发审核、历史任务和策略降级边界。
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Coordinator independently reran gate and public-entrypoint protocol fixture tests: 14 pass, 0 fail, 33 assertions. Covers pending-request HTTP/MCP rejection, CLI combined material+Done byte preservation, bulk completion, direct draft promotion, both demotion paths, historical metadata/reopen and disabled ordinary projects. These Python protocol fixtures prove routing but are not real rq G4 evidence. Real adapter tests separately pass approval/stale/idempotency/projection scenarios. Public rq accepts milestone or whole project; task-scoped fresh G4 not provided.

12:23协调者独立HTTP/MCP路由与两个gate专项24pass79assertions，含真实rq低风险完成、材料+Done原子拒绝、各公开写入口、批量、生命周期/降草稿、历史终态元数据可编辑/可重开。真实规范CLI闭环1pass8assertions37.53s补证旧审批失效/重新验收/Done。历史状态与票面勾选不形成批准；审批始终由rq权威台账判断。整仓Biome失败保留DOD2。
<!-- SECTION:NOTES:END -->
