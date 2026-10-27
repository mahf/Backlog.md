# 多目录工作台使用指南

本文面向本地定制分支。任务仍保存在各项目的 Markdown 中；登记目录不会移动或复制任务。目录标识 `--workspace` 与任务分类 `--project` 是两个不同概念。

新需求从 Superpowers、OpenSpec、grill-me、to-spec 等工具统一到原生父子任务的流程，见 [需求到交付指南](requirements-to-delivery.zh-CN.md)。新工作直接用 Backlog CLI 创建，不要求迁移历史 tickets。

## 构建

在源码目录执行：

```powershell
bun install
bun run check:types
bun scripts/build.ts
bun src/cli.ts --help
```

以下示例使用安装后的 `backlog`。从源码运行时，将它替换为 `bun D:/TMP/backlog.md/Backlog.md/src/cli.ts`。rq 是单独配置的可选工具，不随此分支安装；指向 Python 脚本时还需要 Python。

Windows 构建产物为 `dist/backlog.exe`。本轮网页验收使用此产物启动；当前 Bun 1.3.10 直接运行源码 browser 可能返回空 HTML，因此网页请使用构建后的程序。

## 初始化和登记

已有项目直接登记。普通文件夹可以先在该目录初始化，无需创建 Git 仓库：

```powershell
Set-Location 'D:/Projects/中文项目'
backlog init '中文项目' --no-git --defaults --agent-instructions none
backlog workspace register 'D:/Projects/中文项目' --id local --name '中文项目' --writable true
backlog workspace register 'D:/Projects/reference' --id reference --writable false
backlog workspace list --json
```

登记目标必须是项目本身，不能借用祖先目录的 Backlog。默认只读；`--writable` 只接受 `true` 或 `false`。同一实际目录的大小写别名、符号链接或 junction 不应重复登记。

注册表默认位于用户目录的 `.backlog/workspaces.json`。演示或测试时可使用独立注册表：

```powershell
$env:BACKLOG_WORKSPACES_FILE = 'D:/Demo/workspaces.json'
```

删除登记不会删除项目文件：

```powershell
backlog workspace edit local --name '本地项目' --writable true
backlog workspace remove reference
```

## 查询和写入

```powershell
backlog --workspace local task list --plain
backlog --all-workspaces task list --plain
backlog --workspace local task view TASK-1 --plain
backlog --workspace local task create '验证目录定位'
backlog --workspace local task edit TASK-1 --status 'In Progress'
```

跨项目重号是合法的。保存任务链接、查询结果或自动化输入时，同时保存目录标识与任务号。聚合写入不猜测目标；只读、失联或未知目录必须先解决定位问题。原有单项目入口继续从当前目录（或 `BACKLOG_CWD`）发现项目。

## 网页与终端

```powershell
backlog --workspace local browser --no-open --non-interactive
backlog --workspace local board
backlog --all-workspaces board
backlog --all-workspaces board --json
```

网页仅监听本机 `127.0.0.1`。项目选择器用于选择目录或聚合范围；聚合任务的来源标识用于区分重号。单项目任务链接形如 `/tasks/TASK-1?workspace=local`；聚合详情形如 `/tasks/TASK-1?workspace=all&taskWorkspace=local`，必须同时保留所选任务的目录身份。

`board` 是原生终端界面，`browser` 是网页入口。终端用 `w`／`W` 切换目录范围，Tab 切换原生视图，Ctrl+G 打开当前目录的人工收件箱；在聚合范围创建任务或打开收件箱前先选择目标目录。收件箱中方向键选择请求、`m` 查看材料、Tab 切换列表/详情、PageUp/PageDown 滚动。数字键核对当前页，`[`／`]` 换页；`o` 输入 `M2: 失败现象` 可记录指定检查项的观察。Enter 打开答复，Ctrl+A 选择动作，`r` 刷新，Escape 返回。批准前必须完成所有核对且没有失败观察；`changes` 可保留 UNCHECKED/FAIL。具体证据见 [验收记录](workspace-validation.md)。

## 启用 Workflow

在目标项目配置 rq 的实际路径：

```powershell
backlog workflow config --workspace local --enabled true --rq-path 'D:/Tools/workflow/tools/rq.py' --python-path python
backlog workflow status --workspace local --json
backlog workflow board --workspace local --json
backlog workflow inbox --workspace local
```

使用 `backlog workflow <command> --help` 查看当前支持的参数。查询和变更都调用已有 rq CLI；`backlog/decisions/approvals.jsonl` 是决定与答复的权威台账。任务 Done、核对清单和派生快照均不构成有效批准。

```powershell
backlog workflow request TASK-1 decision '采用哪种方案？' --recommendation '方案 A' --workspace local
backlog workflow respond REQUEST-ID '采用方案 A' --action answer --idempotency-key local-response-001 --workspace local --json
backlog workflow cancel REQUEST-ID --reason '需求已替代' --workspace local
```

`REQUEST-ID` 使用查询返回的真实 ID；审查、验收和授权需使用所见版本与该请求允许的动作。网络错误后重试同一答复应复用幂等键；改变答复内容不能冒充同一次重试。人工核对与机器检查分开，材料变化后需重新核对。

## 故障恢复

| 现象 | 处理 |
| --- | --- |
| 项目不可访问 | 恢复目录或修改登记，其他可用项目继续读取；不要将失联视为零任务 |
| Workflow 未配置或找不到工具 | 检查 config、Python 与 rq 路径；普通未启用项目仍可管理任务 |
| 版本冲突 | 保留文字，刷新材料并重新核对；不要绕过旧版本校验 |
| 答复保存但投影待修复 | 保留 rq 返回的请求号和原始结果，按 rq 的恢复提示修复；不要再次创建请求或补造审批 |
| 会话未绑定或后端离线 | 答复与接续分别处理；恢复原绑定后重试，不静默启动新 Agent |
| 文件监听失败 | 页面显示回退提示，继续按 TTL 核验；用 Refresh 立即重读所选目录范围。健康监听保留，恢复后清除提示 |

“已保存”“传输接受”“明确接收”“运行”“完成”是独立事实。没有可靠或足够新的信号时显示未知，传输接受不表示任务已经执行。

无变化查询使用目录缓存；正常监听事件使对应目录失效，后台每个目录错开 30～60 秒审计漏事件。手动 Refresh 绕过当前缓存，后台轮询不会强制重读。批准提交仍核验最新请求与材料版本。

## 兼容与数据边界

现有 `backlog/tickets` 与原生 `backlog/tasks` 的读取由 rq 兼容。发现同一目录内身份冲突时拒绝歧义操作，不复制影子任务。迁移先预览并核对关联材料：

```powershell
backlog workflow migration preview --workspace local --json
backlog workflow migration apply --workspace local --confirm --fingerprint '<预览返回的指纹>'
backlog workflow migration recover '<指纹>' --workspace local
backlog workflow migration rollback '<指纹>' --workspace local
```

迁移保留原文备份和恢复日志，旧批准不会因迁移自动变为当前有效批准。先在备份或隔离副本中演练，停止其他写入，核对任务数量、原始 ID 和台账；回退拒绝覆盖并发产生的新内容。完整规则见 [迁移指南](workflow-migration.md)。

本系列采用 Backlog 原生网页和 TUI 扩展路线，取代旧 BACKLOG-BRIDGE 文档中独立 rq 网页的接入方向；旧 rq CLI 在新版入口验证完成前保留。

OneDrive 仅同步文件，不提供分布式锁或跨机器一致性。同一项目应由单台主机承担写入；不要在多台机器同时提交审批或迁移。测试只使用隔离目录，不在真实项目创建测试批准。
