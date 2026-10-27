---
id: BACK-791
title: 网页多项目工作台：项目切换、聚合看板与任务直达
status: In Progress
assignee:
  - '@luna'
created_date: 2026-10-23 07:41
updated_date: '2026-10-26T04:50:00Z'
labels:
  - local-workbench
  - multi-root
dependencies:
  - BACK-788
references:
  - C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/USAGE.md
  - C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/REVIEW-UX.md
priority: high
ordinal: 401000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
以 Backlog 现有 browser 为唯一主要网页入口，继承其看板、任务列表、拖动、原生字段编辑、Markdown 文档与里程碑交互。新增全部项目和单项目范围，用户在一个窗口看任务并明确写入目标；保持 Backlog 现有视觉组件和简洁信息层次。此票负责任务工作台与导航，人工请求处理由关联需求负责，不另建一套独立 rq 网页。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 提供全部项目/单项目切换，聚合任务显示项目来源并可搜索筛选；目录项目与任务 project 分类使用不同标签。
- [x] #2 从单项目新建自动带目标；全部项目新建必须明确目标，不能默认写入第一个项目；只读项目不提供可执行写操作。
- [x] #3 在详情中沿用原生负责人、优先级、标签、依赖、计划、评论和文档能力；拖动及更新结果遵守目标项目配置及适用门禁。
- [x] #4 任务直达链接和浏览器前进后退保留正确项目/任务/筛选；任务已移动、重复或项目失联时给出明确提示。
- [x] #5 恢复上次项目范围与视图偏好；后台更新不抢焦点、清空正在编辑内容或导致详情无故关闭。
- [ ] #6 桌面交互实测包含项目切换、搜索、编辑、只读、重号和失败恢复；窄屏可访问主要动作，键盘导航和对话框焦点正确。
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
协调者验收：多目录切换、聚合同号身份、只读详情、跨项目隔离写入及导航恢复已通过专项回归与编译版页面。实际 all+b 切换 a 后仅 a 标题更新，b/local 保持原值。严格 AC6 的完整物理桌面键盘/鼠标和窄屏走查未完成，保持未勾选；整仓 Biome 未通过，不转 Done。详见 docs/workspace-validation.md。
<!-- SECTION:NOTES:END -->
