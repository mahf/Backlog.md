---
id: BACK-799
title: 优化任务详情弹窗布局与大纲导航
status: In Progress
assignee:
  - '@codex'
created_date: '2026-11-10T01:53:00Z'
updated_date: '2026-11-10T05:22:00Z'
labels: []
dependencies: []
references:
  - src/web/components/TaskDetailsModal.tsx
  - src/web/components/Modal.tsx
modified_files:
  - src/web/components/Modal.tsx
  - src/web/components/TaskDetailsModal.tsx
  - src/test/web-task-details-modal-unsaved-navigation.test.tsx
ordinal: 409000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
长任务的正文和属性随整个弹窗一起滚动，阅读与跨章节定位困难。用户要求加宽弹窗、增加大纲导航并固定属性区域。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 桌面弹窗加宽，正文独立滚动，右侧属性不会随正文滚动
- [x] #2 大纲列出实际可见的内容章节，点击可定位到对应章节，编辑模式仍可导航
- [ ] #3 窄屏内容和属性均可访问，关闭与保存等现有交互保持正常
- [x] #4 大纲可随时隐藏和重新展开，隐藏后正文回收空间；选中章节有独立高亮并随正文滚动同步
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1.复用Modal提供可选内部滚动布局。2.加宽任务弹窗并添加可见章节大纲与独立正文和属性滚动区域。3.运行针对性测试、类型检查和构建。

4.根据用户截图增加Word式大纲显示切换，优化当前章节高亮与滚动同步，补交互回归测试。

5.将大纲显示开关移到大纲栏标题旁并使用图标，收起后保留可展开入口。排查章节点击卡顿，最小化滚动过程中无效章节更新和重型详情重渲染，补交互回归。
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
实现完成：最大1600px弹窗、章节大纲、桌面正文与属性独立滚动、窄屏沿用弹窗内容滚动。36项聚焦DOM测试通过，原生TypeScript编译器--noEmit通过，bun scripts/build.ts通过，git diff --check通过。浏览器与原生Computer Use服务均不可用，未完成真实桌面/窄屏视觉验收，因此AC1/AC3保留待验收。Biome includes排除TSX，本次未修改全局检查配置，DoD2未勾选。官方同步只做调查：origin/main有10个未合入提交，建议优先3a296c0f和e1a67143，decision系列作为整体评估；试合并5文件冲突，未合并或提交。

根据用户截图追加优化完成：顶部Outline开关可隐藏/恢复大纲，隐藏时正文回收列宽；当前章节使用浅蓝背景、左侧强调条和加粗，键盘焦点使用focus-visible。点击与桌面正文滚动同步aria-current。37项聚焦测试通过（含展开收起、选中、滚动同步），原生tsc --noEmit、bun scripts/build.ts、git diff --check通过。窄屏支持点击导航，手动滚动跟随仅桌面独立正文滚动容器；未做新增视觉验收。

根据最新反馈：Outline开关已移至左侧大纲标题旁，使用带aria-label/title的图标，收起后保留2.5rem窄入口且焦点保留；移除Modal头部文字按钮。点击导航从smooth改为auto直接定位，避免跨章节动画触发多次高亮/整块详情重渲染，手动滚动跟随保留。9项交互测试81断言通过；全仓Biome520文件通过、build通过、子agent报告bun run check:types通过。主模型native tsc一次挂起已终止，bun包装器一次报node_modules bin映射错误，未改依赖；以子agent通过结果为类型证据。6439源码与6440 ToDo编译服务已重启，HTTP页面bundle均验证新图标/窄栏代码存在。未做真实浏览器流畅度或视觉验收。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
任务弹窗加宽至1600px，桌面正文独立滚动。左侧大纲标题旁图标可收起展开，收起保留紧凑入口。章节点击直接定位，避免平滑滚动途经章节引发重复渲染；手动滚动仍同步高亮。9项本轮交互测试、类型检查、全仓Biome与build通过。6439/6440已更新；真实浏览器视觉/流畅度验收仍待确认。
<!-- SECTION:FINAL_SUMMARY:END -->
