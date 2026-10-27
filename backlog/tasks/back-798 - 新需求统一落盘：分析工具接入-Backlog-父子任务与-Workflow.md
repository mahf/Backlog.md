---
id: BACK-798
title: 新需求统一落盘：分析工具接入 Backlog 父子任务与 Workflow
status: Done
assignee:
  - '@codex'
created_date: '2026-10-27T05:48:00Z'
updated_date: '2026-10-27T07:20:00Z'
labels: []
dependencies: []
documentation:
  - docs/requirements-to-delivery.zh-CN.md
  - docs/requirements-workflow-validation.md
ordinal: 408000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
需求分析可使用 Superpowers、OpenSpec、grill-me 或 to-spec，但新工作统一由 Backlog CLI 创建父子任务；Workflow 复用同一任务身份管理证据与审批。只调整新流程，不迁移或改写已有业务票与审批。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 统一落盘约定及可发现的 skill 明确父子任务、规格引用、依赖和 CLI 编号分配，不产生第二份正式票或验收条件
- [x] #2 rq 和格式校验支持 CLI 生成的原生父子任务及项目配置状态，保持证据版本和审批门禁，不直接改写 Backlog 原生任务
- [x] #3 Workflow 规则模板和中文流程使用说明提供一致的新任务操作链路，现有旧票保持兼容且不执行迁移
- [x] #4 隔离项目验证父子任务创建、rq 读取和检查、请求答复及材料变化失效；相关测试通过并记录限制
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. 核对 Workflow 规则、rq 原生任务读取与 lint。2. 委派 Luna 调整明确的实现和相关测试。3. 统一落盘规则、接入 skill 和中文指南。4. 在隔离项目执行 CLI 与 rq 集成回归并审查差异。
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
已交付新需求统一落盘 skill、Backlog 原生父子任务约定、共享 Workflow/rq 与 PowerShell lint 调整、中文操作指南；不迁移旧票。最终独立复验 rq 66 项、Bun 26 项、lint 2 项全部通过。decision 答复与 check --fix 不改写原生任务；当前证据和审批随材料/AC 变化失效。全仓 bun run check . 无法创建进程，直接 Biome 检查仍有 452 项错误；DoD2 未满足，保留 In Progress。本次未触及 TypeScript，未执行类型/构建检查；未提交或发布。详见验证记录。

2026-10-27 继续收尾：.gitattributes 新增 TS/CJS/JSON 的显式 LF 规则，规范化452文件的CRLF字节；业务内容逐字节等价，Git规范化diff不变，仅新增3行属性规则。协调者独立验证实际 bun run check . 退出0且519文件通过；原生Biome519通过；node tsc --noEmit 与 bun run --bun check:types 均退出0。DoD1依据同一tsc在--bun模式及原生Node下的实际通过，未声称不加--bun包装器稳定。相关Bun26项再次通过。包装器仍间歇出现bin remap/EPERM，Git status有stat残留但内容diff/代表性哈希一致，详见验证记录；未修改依赖、stage、commit或发布。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
新需求通过 backlog-intake 从任意分析工具收敛到 Backlog 原生父子任务，Workflow/rq 复用同一身份管理证据、请求与版本绑定审批，保留旧票兼容且不迁移。中文流程、共享规则和模板已更新。原生rq66、Bun26、PowerShell lint2通过；全仓Biome519及等价tsc类型检查通过。补齐Git LF规则以消除452项换行误报。已记录本机Bun启动器不稳定及Git stat残留；未重跑全量测试/构建/桌面验收，未提交发布。
<!-- SECTION:FINAL_SUMMARY:END -->
