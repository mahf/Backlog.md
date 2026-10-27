# 新需求统一落盘验证记录

日期：2026-10-27。任务：BACK-798。范围：新需求统一为 Backlog 原生父子任务，Workflow 读取同一任务、维护证据与审批。不迁移历史票、不修改真实业务审批、不提交或发布。

## 改动

| 位置 | 改动 |
|---|---|
| 本仓库 AGENTS.md（CLAUDE.md 是其符号链接） | 指向统一需求流程，明确原生父子任务为正式结构 |
| docs/requirements-to-delivery.zh-CN.md、multi-workspace.zh-CN.md | 新流程入口及多目录指南交叉引用 |
| 共享 workflow/BACKLOG-FLOW.md | 中文使用手册：分析工具交接、项目接入、父子任务、依赖、证据、人工请求及完成 |
| workflow/DOC-CONVENTIONS.md、BACKLOG-BRIDGE.md | 唯一字段与产物归属，区分统一入口和兼容入口 |
| workflow/README.md、USAGE.md、EXAMPLES.md、AGENT-ROUTING.md、TEST-POLICY.md、REVIEW-UX.md、REVIEW-POLICY.md | 清理默认旧票入口，保留旧用法的明确兼容边界 |
| workflow/templates/NATIVE-TASK.md、TICKET.md、ORCHESTRATION-PLAYBOOK.md | 原生 Description 补充指引，旧模板仅兼容 |
| workflow/tools/rq.py、test_native_backlog.py | 原生 Description/AC 权威读取、编号映射、父子/依赖元数据、当前检查作为原生功能结果及回归 |
| workflow/hooks/ticket-lint.ps1、hooks/README.md、tools/test_ticket_lint.py | 原生结构只读校验、项目状态、父级与依赖引用，保留旧票校验 |
| 本机 .codex/skills/backlog-intake/SKILL.md | 通用需求落盘 skill；.agents/skills 使用同源 junction |
| 共享 agent-common/工作目录/AGENTS.md | 新项目模板指向原生任务流程；不自动批改其他现有业务项目指令 |

共享 Workflow 实际位置：`C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow`。修改前该仓库已存在 staged/unstaged 改动，本次保留；没有重新 stage、commit 或覆盖其余文件。

## 验证

- Skill：使用隔离的 `uv run --with pyyaml python -X utf8 <skill-creator>/scripts/quick_validate.py <backlog-intake>`，通过。默认 Python 缺 PyYAML，未向项目新增依赖。
- 文档：新流程、约定、桥接及原生模板的相对链接存在性检查通过；两技能目录指向同一文件。
- Lint：协调者独立运行 `python -X utf8 -B -m unittest tools.test_ticket_lint -v`，2 通过、0 失败、0 跳过，12.910 秒。另在临时 fixture 移除旧票目录后执行全量 lint，3 个原生任务通过、stderr 为空。
- PowerShell：实现者验证语法解析与 UTF-8 BOM，支持 powershell.exe 5.1。发现单个旧票的 FileInfo 加法异常曾导致错误退出码 0，已修复并移除掩盖问题的 SkipTest。
- rq：协调者在最终源码修改后独立运行 `python -X utf8 -B -m unittest tools.test_native_backlog tools.test_rq.PolicyTests tools.test_rq.GateTests tools.test_rq.W2Tests tools.test_rq.LedgerTests -v`，66 通过、0 失败，110.332 秒。日志：`D:/TMP/back-798-rq-final-ownership.log`。
- Backlog：最终独立运行 workflow-cli-e2e、workflow-adapter、workflow-gate、workflow-gate-entrypoints 四个 Bun 测试文件，26 通过、0 失败、84 断言，75.53 秒。日志：`D:/TMP/back-798-backlog-ownership.log`。
- 原生任务回归覆盖 CLI 创建父子任务、原生 Description/AC 权威读取、稀疏编号及空区块、检查与版本绑定、勾选不能替代检查、请求答复及审批失效。最终审查另补两处保护：decision 答复只记台账、不投影原生任务表格；`check --fix` 仅降级旧票状态。新增测试验证任务字节不变、待决定项正确关闭，旧票投影回归继续通过。
- `git diff --check` 在本仓库和共享 Workflow 均通过；未批量重写无关文件。
- 初次 `bun run check .` 失败：本机 Bun bin remap 无法创建进程；原生 Biome 检查 519 文件、452 错误。后续处理结果见下节，不把此历史结果作为当前结果。

## 继续收尾：换行规则与完整检查

- `.gitattributes` 为 `*.ts`、`*.cjs`、`*.json` 明确 `text eol=lf`，与现有 Biome 默认规则一致。未放宽 lint、修改依赖或改变 Markdown 换行规则。
- 对 Biome 检查范围执行字节级 CRLF → LF 规范化；已保存原始字节备份，规范化后的业务内容与原内容完全一致。Git 内容差异只新增 `.gitattributes` 三行规则；原有业务改动保留。
- 协调者独立执行原生 `biome.exe check .`，519 文件通过、无修复；实际 `bun run check .` 也取得一次退出码 0、519 文件通过。后续仍出现 Bun bin remap/EPERM，属于启动器不稳定，不能承诺每次包装命令都可运行。可直接执行 `./node_modules/@biomejs/cli-win32-x64/biome.exe check .`。
- 类型检查：协调者独立执行 `node node_modules/typescript/bin/tsc --noEmit` 和 `bun run --bun check:types`，均退出码 0；未加 `--bun` 的包装命令仍出现 bin remap 失败。本次没有 TypeScript 逻辑改动。
- 相关四个 Bun 回归文件再次通过：26 测试、84 断言、57.08 秒，日志 `D:/TMP/back-798-format-regression.log`。rq 与 PowerShell 源码本轮未变，沿用前节 66 项与 2 项独立验证结果。
- `git diff --check` 通过。未重跑全量测试、构建或桌面验收；本轮只有换行策略和字节规范化，无运行逻辑变化。
- 本机 Git status 暂留部分换行变更的 stat 记录；`git diff --name-only` 和规范化内容比较仍为原 33 个业务差异加 `.gitattributes`，代表性基线文件的 worktree/index/HEAD 哈希相同。未通过 stage、reset 或改写索引内容清理这些记录。字节备份和核对报告：`D:/TMP/backlog-format-gate-20261027/eol-policy-20261027-151319645/report.txt`。

## 范围与限制

- 本次没有 TypeScript/前端逻辑变化；未重建 Backlog 二进制、未重跑构建和物理桌面验收。后续补跑了类型检查，见上节。用户检查用 6437/6438 服务保持运行；rq 由适配器逐次启动，读取更新后的脚本。
- 新增 Python/PowerShell 测试只写隔离临时项目，实际创建父子任务和证据，不伪造真实业务批准。
- rq 当前使用默认 backlog 布局；不承诺自定义任务目录已被 rq 支持。自定义状态需配置 status_map。
- 父级与 dependencies 在 rq 输出中是元数据；本次没有新增依赖调度器或自动父任务完成逻辑。派发者检查依赖，父任务单独验证整体结果。
- 上游 Superpowers/OpenSpec/grill-me/to-spec skill 未 fork；通过项目指令和 backlog-intake 交接。其他已有项目如固化旧票规则，需在接入新流程时改为指向共享约定。
- 旧 tickets、旧独立 rq 看板和登记表保持兼容，不自动迁移或同步两个注册表。
- BACK-798 四项功能验收已验证；后续整仓格式与类型检查已取得通过证据。保留本机 Bun 包装命令不稳定的限制，不将其描述为始终通过；也不据此宣布 BACK-787–797 全部完成。
