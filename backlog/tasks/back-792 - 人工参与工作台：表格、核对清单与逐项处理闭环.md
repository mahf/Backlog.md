---
id: BACK-792
title: 人工参与工作台：表格、核对清单与逐项处理闭环
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
  - BACK-790
  - BACK-791
references:
  - C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/USAGE.md
  - C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/REVIEW-UX.md
priority: high
ordinal: 402000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
用户需要快速识别并处理真正需要人的决定、审查、验收和授权。将既有 rq 人工请求融入 Backlog 的待我处理页及任务详情，在表格中展示问题、建议、影响、所属项目、任务和下一步；材料缺口与机器检查失败清楚区分。Checkbox 用来确认人工核对，不代替机器 PASS 或审批。保留跨项目处理队列，但每项独立答复和留证。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 待我处理按项目和请求类型筛选并显示数量；列表明确问题、建议、影响/范围及处理动作，不把仅需 Agent 补材料的项目混入可批准请求。
- [x] #2 决定支持采用建议/自定义答复；审查用断言与检查证据表；验收显示入口、前置、步骤、预期并允许逐项通过或填写失败现象；授权明确动作、环境、范围和期限。
- [x] #3 Checkbox 默认未勾选，人工与机器结果分开；版本变化后清除失效核对并提示变化，保留文字供参考但不自动套用批准。
- [x] #4 仅对当前可见、可写请求全选后依次处理；每项保存成功进入下一项，失败留在当前项且保留输入，不提供一键批量批准。
- [x] #5 重载后可恢复按项目/任务/请求身份隔离的文字草稿；恢复时重新核验版本；自动更新保留焦点、输入和展开状态，长表单提交动作可达。
- [x] #6 默认呈现决定所需摘要与变化，原始材料按需展开；重复提交不重复留证；取消/替代请求不可再答复。
- [ ] #7 用户完成保存后可分辨答复保存与 Agent 接续结果；测试与桌面人工走查覆盖四类请求、只读、冲突、过期、失联和无鼠标操作。
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
协调者验收：四类请求渲染、机器断言和人工清单分离、默认未勾选、中文失败观察、跨版本草稿、逐项保存及恢复队列均有专项回归。编译版页面实际提交后核对 rq 台账，且新版成功保存清除文字与观察草稿；已答复恢复项禁选，ready/recovery 数量分开。完整物理桌面无鼠标走查尚未完成，AC7 保持未勾选；整仓 Biome 未通过。
<!-- SECTION:NOTES:END -->
