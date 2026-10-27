---
id: BACK-793
title: Agent 协作：展示接续事实并减少不必要的人工与重启
status: In Progress
assignee:
  - '@luna'
created_date: 2026-10-23 07:42
updated_date: '2026-10-26T04:50:00Z'
labels:
  - local-workbench
  - multi-root
  - workflow
dependencies:
  - BACK-789
references:
  - C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/USAGE.md
  - C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/REVIEW-UX.md
priority: medium
ordinal: 403000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
现有痛点是 Agent 编排偏重且人工答复后不清楚是否继续执行。复用 workflow 已绑定会话与风险路由，Backlog 中展示当前动作、等待原因及答复后接续，不要求所有普通任务启动协调者/独立审查 Agent。现有 rq 区分已保存、传输接受、明确接收、运行和完成；无可靠信号必须显示未知。此需求不建设新通用 Agent 调度平台，也不强制依赖 Orca（现有可选会话后端）。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 任务详情及可汇总的会话视图显示所属项目/任务、可验证当前动作、等待人/等待材料等原因与状态时间；过期或无信号显示未知。
- [x] #2 人工答复后沿原绑定会话接续，展示保存、传输接受、明确接收、执行、完成的独立事实；传输成功不被表述为已执行。
- [x] #3 未绑定、后端离线或投递失败时保留答复并提供手动恢复/重试；重试不重复答复，不静默新建或重启 Agent。
- [x] #4 现有低风险路径无需额外多 Agent 环节，审查/验收/授权只按生效策略出现，保持完整无 Agent 人工操作路径。
- [x] #5 CLI 支持同等状态查询和接续恢复，网页/TUI复用同一语义；公开说明可选后端及其限制。
- [x] #6 测试覆盖低风险、缺绑定、重复投递、明确确认、旧信号、离线、答复已保存但投递失败和跨项目同名会话任务。
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
协调者验收：任务/会话事实隔离、过期信号未知、答复保存与传输/执行分离、缺绑定及重试有专项测试。隔离 TASK-3 的 E2E-BOUND 真实绑定会话明确 ACK received/running/completed，并读取原生任务写限定结果文件；公开 workflow board 独立核实同一 session/ticket completed 与时间，不以 input_accepted 推断执行。无真实项目审批改动。整仓 Biome DOD 未通过，保持 In Progress。
<!-- SECTION:NOTES:END -->
