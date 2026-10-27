---
id: BACK-789
title: Workflow 接入：复用 rq 证据与人工请求并提供规范 CLI
status: In Progress
assignee:
  - '@luna'
created_date: 2026-10-23 07:41
updated_date: '2026-10-26T05:05:00Z'
labels:
  - local-workbench
  - multi-root
  - workflow
dependencies:
  - BACK-788
references:
  - C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/USAGE.md
  - C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/REVIEW-UX.md
priority: high
ordinal: 399000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
在 Backlog 原生任务与交互上扩展现有 workflow。既有实现位于 C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow，rq.py 管理决定、授权、审查、验收、版本校验和接续；backlog/decisions/approvals.jsonl 是其权威事件台账。目标是让 Backlog 读取与操作这些现有能力，保留 evidence 下 changes.json/checks.json 的语义，不重写审批引擎，不依赖 Backlog 内部 TypeScript 导出作为对外接口。先以规范 CLI 和共享语义交付，再供网页/TUI使用；无 workflow 的项目仍是完整可用的普通任务管理器。参考文件为现状和规则来源；其中独立 rq 看板、不分叉 Backlog 的旧路线由本系列需求取代。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 项目可显式配置或禁用既有 rq workflow 接入；禁用或未安装时普通任务功能可用，启用但不可用时显示具体故障且审批不假成功。
- [x] #2 公开 CLI 可查询请求、材料摘要、工作流就绪度并提交决定/审查/验收/授权及取消请求；提供稳定机器输出和帮助，不要求 Agent 阅读源码。
- [x] #3 任务进度、请求生命周期和会话接续分别表达；Markdown 勾选、Done 或派生缓存不构成有效批准。
- [x] #4 批准和答复复用现有权威台账、版本校验、幂等及恢复语义；返回业务错误、部分写入与投影待修复的真实状态。
- [x] #5 项目与任务关联不复制原任务；现有 backlog/tasks 映射及 backlog/tickets 兼容规则有明确说明，发现歧义时拒绝猜测。
- [x] #6 测试证明对既有有效/失效审批和请求记录的解释一致，并覆盖无 workflow、离线适配器、重复提交、局部失败及跨项目隔离。
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
协调者复验：真实rq adapter专项测试覆盖已保存投影失败、重复响应、旧revision拒绝、工件修改导致批准stale、重号拒绝及跨项目台账隔离；对应测试8通过（环境变量配置真实rq）。三种workspace选项位置读查询正确；隔离配置disable/enable实际写入仅local，其他两根及源码config SHA256不变。5个Workflow相关文件native Biome检查通过。AC4部分写入/保存与接续机器状态仍须结合最终网页/TUI共用语义复核，任务暂不Done。

12:14协调者独立真实rq规范CLI端到端1pass8assertions37.53s：原生allocator创建、答复保存/幂等、审查、材料变更过期、旧版本拒绝、刷新证据重新审查、门禁Done并读回。适配器专项还覆盖投影待修复与跨根隔离。全量查询挂起正由BACK795读查询并发/超时收尾；不修改权威rq语义。

13:05最终复验：显式真实rq的18文件组合141通过/516断言，包括规范CLI E2E；原生tsc、43修改TS/JSON限定Biome、5新TSX独立Biome与构建通过。整仓Biome仍519文件452错误，不放宽DOD2、不转Done。详见docs/workspace-validation.md。
<!-- SECTION:NOTES:END -->
