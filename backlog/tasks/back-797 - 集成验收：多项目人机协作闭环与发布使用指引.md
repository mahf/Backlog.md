---
id: BACK-797
title: 集成验收：多项目人机协作闭环与发布使用指引
status: In Progress
assignee:
  - '@codex'
created_date: 2026-10-23 07:43
updated_date: '2026-10-26T05:05:00Z'
labels:
  - local-workbench
  - multi-root
  - workflow
dependencies:
  - BACK-791
  - BACK-792
  - BACK-793
  - BACK-794
  - BACK-795
  - BACK-796
references:
  - C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/USAGE.md
  - C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/REVIEW-UX.md
  - C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/BACKLOG-BRIDGE.md
priority: medium
ordinal: 407000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
作为本轮扩展的可交付验收，验证 Backlog 原生 browser/board 与已有 workflow 真正形成一条可由人独立使用的工作流。不要仅凭单元测试或截图宣布可用。使用隔离演示目录，包括两个独立 Git 项目、一个无 Git 项目和一个不可访问项目；不对用户真实项目执行自动迁移或创建测试批准。适用于本地定制分支，沿用 MANIFESTO 的 CLI 规范、Markdown 数据所有权和可选 Agent 原则。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 有可复现的端到端用例：创建原生任务、Agent/人工推进、发起人工请求、表格/Checkbox 答复、原会话接续、证据变化使旧批准失效、重新验收完成。
- [x] #2 网页与终端均验证跨目录同名任务、只读项目、项目失联、离线适配器及并发编辑；普通无 workflow 项目保持原生任务操作。
- [ ] #3 真实桌面与终端交互走查确认信息层次、筛选、详情、快捷键、焦点、长表单、草稿恢复及失败提示；记录实际问题并修复阻断项。
- [x] #4 提供从安装/构建、登记目录、初始化无 Git 项目、启动 browser/board、启用 workflow 到恢复故障的中文使用指南与命令示例，保持单项目旧入口有效。
- [x] #5 记录各验证为通过/失败/未执行，附性能结果、迁移演练及已知限制；不把传输接受当 Agent 完成，不把勾选当有效审批。
- [x] #6 按实际变更运行类型、格式、相关回归及构建检查；无授权不提交、推送、发布或改动真实审批台账。
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Use isolated two-Git plus filesystem-only Chinese directory fixtures and a missing registered root. Verify same-ID targeting, readonly and partial failures through CLI/HTTP/MCP, then rendered browser and real TUI. Record each acceptance as pass/fail/not-run; preserve real projects and ledgers. Write Chinese setup and recovery guide; include actual migration/performance evidence only after measured.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-26 协调验收：已独立确认 workflow 目录选择三种选项位置均返回正确 local 配置；native tsc 和构建通过；真实网页读取隔离中文普通目录 E2E-DECISION，并通过页面 DOM click 保存到 rq response 台账，Saved yes、接收/运行/完成 unknown。模拟 click/key 尚未证明实际交互成功。组合8文件45通过2失败，失败位于正在修正的迁移fixture。迁移中断journal、rq历史身份、增量缓存、保存后刷新、任务级G4仍需完成；不将实现草稿标记Done。详见 docs/workspace-validation.md。

2026-10-26 independent verification: 51 pass, 0 fail, 176 assertions across eight workspace/MCP/HTTP/rq/migration/cache/web test files with real BACKLOG_RQ_PATH. Native tsc currently passes. CLI option placement verified by actual isolated config disable/enable with unchanged source/git-a/git-b config hashes. Real 80x24 native TUI Chinese board/help/detail/exit passed; inbox shortcut conflict and checklist/focus remain under correction. Full suite still running with observed failures; no all-green claim. History-bearing legacy tickets remain blocked from migration pending real identity-preservation evidence.

2026-10-26 后续独立验收：真实 80x24 TUI 完成 E2E-TUI-ANSWER 中文答复保存，界面显示 saved 与 delivery pending，Escape 返回看板，n 不穿透。四文件新回归31通过1失败124断言，失败为只读 doc list 别名误拦截，已交回。审查另发现跨目录外部事件未转发、切换请求残留旧保存事实及 TUI 直接 rq 调用绕过只读风险，均在修复。整仓 Biome 461错误含未改文件CRLF，未批量转换；全量测试仍运行且存在失败。验收文档已更新，不标记完成。

最新验收：CLI保存事实/选择器/TUI helper10通过39断言；迁移+注册表27通过97断言；网页事实+门禁33通过94断言；HTTP/MCP/缓存/真实屏幕popup25通过107断言。独立网页实测all+b切换a后仅a标题写入，其他根不变；终端权限撤销拒绝且无新台账，但恢复后重试出现文字清空，已交回修复。会话串项目追溯至HTTP detail缺workspaceId已修，待重启编译版复验。完整套件挂起已终止，非仍运行；decision测试污染已通过CLI恢复且该文件diff为空，测试目录改外部Temp。性能完整5次运行未完成，仍不得宣布全套Done。详见docs/workspace-validation.md。

12:10协调者继续验收：原生看板/统一视图/网页导航/选择器29pass131assertions，tsc及diff--check通过；新PTY实测重号b详情Escape保持b、w切local、CtrlG、方向键、m及CtrlD滚动。权限撤销拒绝且保留中文草稿，恢复后按原文保存，独立ledger精确response仅1条。PageDown尚未生效正修复；30项目180秒仍2800/3000，捕获两实际挂起board子进程，正修复查询并发/超时恢复；不视为性能通过。网页逐项失败观察及规范CLI长集成时限仍收尾。

13:05收尾：18文件141通过516断言；最后缓存/网页/HTTP恢复另起进程39通过115断言；配置decision两文件54通过1Windows跳过424断言。原生tsc、43修改TS/JSON限定Biome、5新TSX独立Biome、git diff --check及最终构建通过。新版编译页面实际确认all手动refresh请求及e2e-bound completed独立事实。1/10/30各5轮最终基准完整，30项目热p95 93.5ms、自然可见p95 1391.4ms。整仓Biome519文件452错误、完整Bun套件未通过；AC1同一任务贯穿所有阶段的可复现单用例与AC3完整物理桌面走查仍未完成，不勾选不转Done。Orca无active/reclaimable；已停止测试服务与PTY，外部复用终端按release回执保留。未提交、推送、发布或写真实审批。
<!-- SECTION:NOTES:END -->
