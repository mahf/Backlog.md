---
id: BACK-794
title: 终端 board：复用原生 TUI 支持多目录与人工处理
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
  - BACK-788
  - BACK-789
  - BACK-790
  - BACK-793
references:
  - C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/USAGE.md
  - C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/REVIEW-UX.md
priority: medium
ordinal: 404000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
用户明确 board 表示终端方式、browser 表示网页方式。扩展现有 Backlog 完整 TUI，让用户无需离开终端即可浏览多个独立目录任务与待我处理；沿用方向键、搜索、筛选、详情、编辑与移动习惯，不退化为 rq 的编号文本列表，也不引入另一套状态和审批规则。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 终端可进入全部项目/指定项目范围并切换；重号任务显示来源，目录范围和任务分类筛选区别清楚。
- [x] #2 保留原生方向键导航、搜索筛选、详情、创建/编辑/移动常用操作；新建明确目标项目，所有写入按同一定位、权限与门禁校验。
- [x] #3 提供待我处理入口和四类人工请求详情，可用键盘查看材料、完成核对和提交答复；逐项处理与网页的校验语义一致。
- [x] #4 终端能够查看答复保存和会话接续状态，故障可恢复且输入不丢失；无 Agent 时仍可人工完成流程。
- [x] #5 非交互读取提供稳定机器输出并退出，写入缺必要输入时失败而非阻塞；保持现有 board 与 browser 命令语义兼容。
- [x] #6 验收包含真实终端交互、窄终端、中文内容、键盘焦点、项目失联及同名任务；自动测试覆盖定位、权限、版本和单项目兼容。
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Extend native board scope loading with explicit workspace identity, aggregate read-only safety, stable non-interactive output, and preserve existing TUI navigation and mutation semantics.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
协调者完成实际 80x24 PTY：多目录来源与切换、重号详情 Escape 保持选择、Ctrl+G、方向键、m 中文材料、PageDown、权限撤销保留中文草稿及恢复保存。发现 o 编辑器缺焦点后修复，新增经 screen 焦点键盘输入回归；实际 M2 失败观察和 changes 提交的隔离台账为 M1 UNCHECKED、M2 FAIL 终端实际失败观察。定位/权限/版本及单目录有专项测试；非交互 board JSON 保持兼容。整仓 Biome 未通过，不转 Done。
<!-- SECTION:NOTES:END -->
