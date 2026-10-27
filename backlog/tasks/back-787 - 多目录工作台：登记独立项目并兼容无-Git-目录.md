---
id: BACK-787
title: 多目录工作台：登记独立项目并兼容无 Git 目录
status: Done
assignee:
  - '@luna'
created_date: '2026-10-23 07:41'
updated_date: '2026-10-23 08:32'
labels:
  - local-workbench
  - multi-root
dependencies: []
references:
  - BACK-643
priority: high
ordinal: 397000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
用户需要在一个 Backlog 工作台管理分散于不同磁盘的多个独立项目，每个目录保留自己的任务、配置和历史。目标仓库 D:/TMP/backlog.md/Backlog.md 当前源码版本为 1.55.2；既有 BACK-643 的 project 字段仅区分同一 backlog 内的分类，不等于多个项目根目录。本需求新增目录级工作区语义，必须避免复用既有 --project 导致含义冲突。Git 是可选能力，普通目录同样可用。范围包括登记、列出、修改显示名/写权限、移除登记和错误恢复；不自动扫描整块磁盘，不因登记而初始化、移动或删除项目数据。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 可登记不同磁盘上的两个独立 Git 仓库和一个无 Git 的已初始化目录，重启后登记仍存在；支持正常的文件模式初始化指引。
- [x] #2 每个登记项有稳定且唯一的目录级标识、显示名、规范化根路径及严格布尔写权限；重复标识、重复根目录和路径别名有明确处理且不产生重复项目。
- [x] #3 单项目原有命令保持兼容；目录级选择与既有任务 project 分类清楚区分，CLI 帮助说明差异。
- [x] #4 修改或移除登记不改动项目任务及证据；不可访问或未初始化目录明确报错且不阻塞其他项目。
- [x] #5 可显式登记同一仓库下不同 backlog 的子目录；不能将仓库祖先目录的 backlog 错当成该子目录的独立存储。
- [x] #6 CLI 提供完整登记管理和机器可读输出；测试覆盖 Windows 空格/中文路径、无 Git、重复路径、不可访问目录和单项目兼容。
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a user-scope workspace registry with canonical path and strict writable metadata, preserving existing single-project resolution. 2. Add workspace register/list/edit/remove CLI commands with JSON output and validation. 3. Cover persistence, aliases, duplicates, inaccessible paths, no-Git projects, Windows paths, and compatibility with isolated fixtures. 4. Run checks and record evidence.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented workspace registry and CLI; scoped tests pass. CLI smoke tested register/list/edit/remove with JSON output. Repository type/lint/build checks remain blocked by Bun/Windows dependency installation issues.

Review fixes: strict registry schema/version/entry validation, Windows root normalization, proper-lockfile read-modify-write locking with unique temp cleanup, per-entry list diagnostics, and 9 boundary tests. Evidence: bun test src/test/workspace-registry.test.ts (9 pass/0 fail, 23 expects), bunx tsc --noEmit --pretty false (pass), native Biome check --write on four touched files (pass), CLI restart register/list JSON smoke (pass).

BACK-788 worker verification: bun test src/test/workspace-registry.test.ts (10 pass, 27 expects); bunx tsc --noEmit --pretty false (pass); bunx biome check on touched workspace files (pass).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the user-scope workspace registry and CLI management with canonical roots, strict writable metadata, duplicate/alias rejection, per-entry diagnostics, atomic locked persistence, and isolated fixture coverage.
<!-- SECTION:FINAL_SUMMARY:END -->
