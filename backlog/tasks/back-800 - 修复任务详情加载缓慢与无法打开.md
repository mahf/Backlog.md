---
id: BACK-800
title: 修复任务详情加载缓慢与无法打开
status: Done
assignee:
  - '@codex'
created_date: '2026-11-10T03:39:00Z'
updated_date: '2026-11-10T05:09:00Z'
labels: []
dependencies: []
modified_files:
  - src/core/content-store.ts
  - src/core/task-detail.ts
  - src/core/task-loader.ts
  - src/git/operations.ts
  - src/server/index.ts
  - src/web/lib/api.ts
  - src/test/content-store.test.ts
  - src/test/core-task-corpus-regressions.test.ts
  - src/test/server-loading-progress.test.ts
  - src/test/web-api-task-detail-timeout.test.ts
  - src/test/web-app-open-detail-refresh.test.tsx
  - src/test/web-task-detail-deeplink.test.tsx
  - src/test/shared-branch-task-loader.test.ts
  - src/test/branch-task-loader-resilience.test.ts
  - src/test/branch-task-loader-fixtures.ts
  - src/test/git.test.ts
ordinal: 410000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
用户反馈点击任务详情需要很久，部分任务甚至无法打开。需要定位详情请求中的重复扫描、远程等待或前端刷新竞态，保留任务身份校验、跨项目定位及现有大纲功能。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 详情读取避免同一请求重复刷新任务与跨分支语料，身份歧义仍明确拒绝
- [x] #2 详情读取过程不会因自身刷新通知持续失效或无提示卡住，跨项目定位和打开关闭行为正常
- [x] #3 有回归测试及实际接口计时验证，构建与类型检查通过
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1.复现详情接口延迟并追踪任务解析、语料加载和前端刷新。2.修复已证实根因并补回归测试。3.重启源码服务、实测接口耗时并验证构建类型。

4.处理已复现的冷启动断连：延长本地服务器空闲等待，仅详情请求使用一次有界的较长等待，清理请求定时器并补回归。

5.批量读取分支任务内容，替代冷启动636次git show子进程；保留固定commit缓存、身份歧义检测和读取失败语义。
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
实测旧详情读取反复发送2~3条tasks-updated通知；修复比较集后连续读取通知数均为0，稳态约328~336ms。另在源码和编译程序新进程均复现首个详情请求约13s后断开，追加修复服务器idleTimeout及详情专用请求等待。

冷启动逐阶段计时：总44.1s；git fetch 2.0s；ls-tree 109ms；分支历史104ms；636次showFile累计324s（并发8）。主要成本为逐文件启动Git子进程。当前6420仍为11月2日安装的旧程序，6439为本次源码预览。

批量OID读取后同仓库独立Core冷启动4042ms（此前44.1s），任务数173保持一致；加载分支阶段约1.0s。首轮修复相关9文件回归136通过0失败；deeplink另有两项既有路由断言失败（筛选参数/URL空格编码），记录但不扩大本次范围。

最终源码HTTP复测：BACK-636冷启动4515ms，热读349ms，graphNodes=12；无变化连续3次读取tasks-updated通知=0；BACK-787返回409，非法ID400，不存在404。已构建新版并以桌面ToDo项目启动6440：TASK-002首读858ms、热读130ms，200且携带关系图。6420旧服务保留。编译页面资源中已确认大纲、1600px对话框和详情60秒等待代码。

最终验证：10文件综合回归141通过0失败；真实Git批量/大管道2测试通过；tsc --noEmit通过；Biome全仓520文件通过；bun scripts/build.ts通过。额外git.test排除showBlobs执行20通过1跳过3超时（删除提交2项/子模块准备1项），未将这3项认定为通过；deeplink仍有两项既有路由断言失败。未做真实浏览器视觉验证。最终6440 ToDo服务HTTP200首读1.109s。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
修复重复ID引发的无变化刷新循环，详情只加载一次共享语料；分支内容从逐文件git show改为基于OID的批量读取，保留缓存、身份冲突与单对象失败重试；延长冷启动详情等待并清理定时器。仓库冷启动44.1s降至约4.5s，热读约0.35s；ToDo首读约1s、热读0.13s。新版在6440运行，6420旧服务保持。
<!-- SECTION:FINAL_SUMMARY:END -->
