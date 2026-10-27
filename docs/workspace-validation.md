# 多目录工作台验收记录

日期：2026-10-26。范围：本地定制分支 BACK-787～BACK-797。本文记录实际证据，未执行项不视为通过。

## 收尾复验（12:54）

本节与之后的收尾追加记录是当前结论。下文带时间的记录及问题跟踪表保留调查过程，已被本节明确验证的旧“待验/修复中”状态不再代表当前状态。

13:05 最终追加：协调者 18 文件组合回归 **141 通过、0 失败、516 断言、100.94 秒**（显式真实 rq，含规范 CLI E2E）；最后监听恢复修改落地后另起进程复跑 cache/web/HTTP recovery 三文件，**39 通过、0 失败、115 断言、12.02 秒**。原生 tsc、43 个已修改/新增 TS/JSON 文件的限定 Biome、5 个新 TSX 组件的外部独立 Biome、git diff --check 与最终 `bun scripts/build.ts` 均通过。23 份 JSON 证据保持解析值不变完成格式化，两份空 stdout 原字节保留为 `.txt`。根配置忽略 TSX，不能把上述 5 组件检查扩大为所有既有 TSX 均通过；既有 TaskCard/TaskColumn 的可访问性诊断及测试 non-null 诊断没有通过全量外部检查。

整仓 Biome 最终仍为 **519 文件、452 错误**，包含未修改文件的 CRLF 等诊断；没有批量改写未修改文件，也没有放宽配置。DOD2 保留未勾选，BACK-788～797 保持 In Progress。BACK-787 原有 Done 保留。BACK-791 AC6、BACK-792 AC7、BACK-797 AC1/AC3 未完成，不能据专项测试宣称整个系列完成。

最终增量恢复补丁已通过：当前未登记目录、指定目录和 all 为三个独立查询范围；监听同步 EACCES/不支持与异步 error 均提示 fallback，缺失可选 scratch ENOENT 不视作故障；监听恢复后清除提示，保留健康监听。显式手动 Refresh 失效所选范围，后台轮询使用缓存。编译版真实 all 页面资源记录证实手动操作发送 `/api/workflow?allWorkspaces=true&refresh=true`；TASK-3 详情显示 e2e-bound、transport input accepted（明确不表示执行）与独立 `Delivery: completed at 2026-10-26T11:50:28+08:00`。

最终构建产物已刷新；所有测试服务与实际 PTY 均已停止。Orca worker-list 显示没有 active/reclaimable worker；对复用外部终端的 release 返回 retained/external_terminal，未擅自关闭用户既有终端。没有提交、推送、发布或改动真实项目审批。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 网页、原生看板、导航与核对表组合 | 协调者独立通过 | 62 测试、241 断言、7 文件；随后 observation 焦点修复再次独立通过 6 测试、27 断言 |
| Windows 配置与 decision 兼容 | 协调者独立通过 | 54 通过、1 Windows symlink 跳过、0 失败、424 断言、123.50 秒；空 argv 使用直接 spawn，缺选项/缺参数/显式空值均保留拒绝与原文件字节断言 |
| 缓存、rq 与 HTTP 失败恢复 | 协调者独立通过 | 19 测试、59 断言；包括 5 秒真实挂起、子进程树清理、下一查询恢复、晚创建 scratch 监听与 dispose/clear 中审计拒绝不重建定时器 |
| 原生 TUI 长材料与 M2 观察 | 实际 80×24 PTY 通过 | m 后 PageDown 显示中文手工步骤；o 最初遗漏焦点导致输入穿透，补 focus 并将测试改为 screen 键盘路由；新 PTY 输入 M2 与中文观察成功 |
| 原生 TUI 实际 changes | 隔离 rq 台账独立核实 | E2E-WEB-review，12:49:22 +08:00，reply 为“请修复第二项中文材料”，M1: UNCHECKED，M2: FAIL 终端实际失败观察，幂等键前缀 5ccf1781；delivery pending 不表示 Agent 执行 |
| 网页恢复队列与授权详情 | 编译版实际页面通过 | 4 ready / 6 recovery；已答复项禁选，恢复原因明确；授权显示请求问题对应的动作和批准阻断原因，不继承任务当前动作 |
| 网页成功后草稿清理 | 编译版页面与 localStorage 通过 | 新 E2E-WEB-decision 保存中文答复与失败观察后，身份对应 draft key 为 null，检查框保持未勾选；旧版保存遗留草稿保留为历史证据 |
| 增量刷新性能复跑 | 协调者完整运行 1/10/30 × 100 × 5 | validation-workspace-benchmark-incremental-final.json 三组均 measured/sampleCount=5；健康监听的查询路径超过 TTL 不重新 fingerprint，后台审计按根错开 30～60 秒 |

新一轮性能：1/10/30 项目 HTTP 热查询 p95 分别 805.2 / 35.7 / 93.5ms，自然变化可见 p95 分别 956.2 / 1385.5 / 1391.4ms。人工材料/答复各五个样本完整保留。HTTP 初次预热中 10 项目两轮及 30 项目一轮出现 rq 长查询，超时后重试最终恢复；预热等待不计入表中的 direct cold cache 指标，不能据此承诺冷启动 13 秒内完成。

仍未完成完整物理桌面鼠标/键盘和窄屏走查，BACK-791 AC6、BACK-792 AC7、BACK-797 AC3 不勾选。真实 CLI 完成闭环、原绑定会话接续、网页和终端人工核对分别有证据，尚没有将所有阶段串成同一任务的可复现单用例，因此 BACK-797 AC1 保留未勾选。完整 Bun 套件没有通过，不把专项回归等同全量通过。整仓 Biome 仍失败；新增 JSON 证据与脚本格式问题正在清理，最终计数以收尾追加为准。

## 最新复验（12:00）

本节覆盖下文早期走查记录中对应的待验状态；未列出的项目仍按原记录处理。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| rq 适配器、规范 CLI、登记及迁移 | 38 通过、0 失败、143 断言 | 协调者显式配置真实 rq 独立运行四个专项文件，40.75 秒 |
| HTTP/MCP 定位、缓存、弹窗选择 | 25 通过、0 失败、107 断言 | 含真实 WebSocket 两目录通知、HTTP 详情 workspaceId、实际 screen 弹窗 Escape 重号选择回归 |
| 聚合只读详情会话隔离 | 通过编译版真实页面 | all + taskWorkspace=b 不再展示 local 请求，编辑字段仍为 0 |
| 原绑定会话实际接续 | 通过隔离演示 | 原生 CLI 创建 TASK-3；E2E-BOUND 答复保存后，同一绑定 Orca 会话 e2e-bound 明确 ACK received、running、completed，并按限定范围读取任务、写 continuation-result.txt |
| 接续最终事实独立复核 | 通过公开 workflow board | request=E2E-BOUND、ticket=TASK-3、status=answered、transport=input_accepted、delivery=completed；agents 中同一 session/ticket 为 completed，delivery_at=2026-10-26 11:50:28 +08:00 |
| 规范 CLI 完成闭环集成 | worker 通过，协调者复跑超时 | worker 27.45 秒、1 通过/8 断言；协调者 30 秒上限时已完成 Done 写入，最终 view 未完成，不能记录为协调者通过；正在声明集成测试时限并重跑 |
| 原生 TUI 权限撤销 | 拒绝写入通过，恢复重试有缺陷 | 中文草稿在拒绝后可见，台账未追加 response；恢复可写后再次 Enter 重建空输入框，已交回修复与回归 |
| 原生 TUI 长材料 | 未通过 | 80×24 的 m 材料视图在 Tab/PageDown 后返回请求摘要，焦点与滚动修复中 |

接续证据均来自系统 Temp 的隔离项目；没有在用户真实项目中创建审批。当前 board 的 completed 不能倒推出每个历史阶段；received/running 的证明来自本次真实 ACK 记录。rq 的 transport=input_accepted 与 delivery=completed 是两个独立事实。

12:10 追加复验：协调者独立运行原生看板/统一视图/网页导航/目录选择器四文件，29 通过、0 失败、131 断言；原生 tsc 通过，git diff --check 通过。新启动的 80×24 PTY 实际确认 b 详情 Escape 后仍选择 b、w 连续切到 local、Ctrl+G 进入收件箱、方向键更新详情、m 展示中文材料、Ctrl+D 滚动到手工步骤。PageDown 当时未滚动，仍交回修复。

同一 PTY 对 E2E-PERMISSION 完成实时权限撤销与恢复：拒绝时保留“权限恢复后精确保留中文草稿”；恢复可写后 Enter 重新打开原草稿，再 Enter 保存。协调者独立读取隔离 approvals.jsonl，精确匹配 request_id/reply 的 response 仅一条（12:07:16 +08:00），不是只凭界面文字宣称成功。

修正后的 30 项目基准在 180 秒预热期限内仅得到 2800/3000 任务，benchmark-6 与 benchmark-22 持续 loading。协调者在进程退出前捕获了对应两个实际 Python board 子进程（启动约 12:01，12:03 仍存活、CPU 约 0.25 秒），证明该轮确有查询挂起；正在限制只读查询并发、增加有界退出及失败缓存恢复，不能用增加预热期限代替修复。1/10 项目的修正样本见 workspace-performance.md。

## 最新复验（12:25）

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 规范 CLI 真实完成闭环 | 协调者独立通过 | 1 测试、8 断言、37.53 秒；显式 rq、独立 Temp；测试声明 120 秒总时限，各子命令仍有 20 秒上限 |
| HTTP/MCP 与门禁最终组合 | 协调者独立通过 | 24 测试、79 断言；包括批准文件 200、批准目录 403、项目外链接 403；跨磁盘链接 fixture 未执行 |
| 网页收件箱与核对表 | 协调者独立通过 | 27 测试、86 断言；含四类请求、过期草稿、失败现象、已答复恢复、授权动作与任务动作分离 |
| 编译版网页四类请求 | 实际渲染与筛选通过 | 本次构建服务中创建隔离 decision/review/acceptance/authorization；审查 A1 表格显示编号、中文内容、PASS，缺材料仍限制批准 |
| 网页验收草稿重载与实际提交 | 通过 Orca fill/reload 与 DOM save | 两项核对均未勾选；中文答复与 M1 失败现象重载恢复；实际 rq response 为 changes，M1: FAIL 加原文、M2: UNCHECKED；不将 DOM save 写作物理键盘鼠标走查 |
| 30 项目性能修复后 | 五次完整采样 | 最终 artifact sampleCount=5，冷查询 rq=30、热=0、变化=1；HTTP 热 p95 187.5ms、自然可见 p95 1237.1ms；旧失败 artifact 保留 |
| OneDrive 隔离测量 | 一项目五次采样 | 独立 mkdtemp fixture、100 任务；HTTP 热 p95 12.6ms、自然可见 p95 1416.0ms；不承诺多机锁或分布式一致性 |

性能记录的 direct cache warm 与 production HTTP warm 分开统计。1/10/30 项目各五次最终原始数据与 OneDrive 样本见 workspace-performance.md；该文件同时保留监听漏事件的 1 秒指纹扫描回退说明。因此 BACK-795 的“无变化不扫描所有项目”严格条款仍不能据此勾选，性能达标也不能替代该实现要求。失败查询不永久缓存、只读超时与不取消写操作的边界回归仍在收尾。

## 已验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 登记、无 Git、路径别名、只读、编号冲突 | 通过专项测试 | workspace-registry.test.ts |
| Workflow、HTTP、网页组件组合回归 | 30 测试通过、99 断言 | 本轮开始时六个专项测试文件；后续改动仍需重验 |
| MCP 公开工具调用与既有启动行为 | 18 测试通过、117 断言 | mcp-workspace-routing.test.ts、mcp-server.test.ts，协调者独立重跑 |
| 三个项目同名 TASK-1 聚合 | 通过 CLI 和真实网页渲染 | 隔离注册表中的 a、b、local；网页显式选择 all 后显示 3 个来源 |
| 中文普通目录的任务深链接 | 通过真实网页渲染 | tasks/TASK-1?workspace=local 显示中文项目标题与任务详情 |
| 只读项目任务详情 | 编辑被禁用 | tasks/TASK-1?workspace=b 中可编辑字段为 0；只读原因文案发现问题并交回修复 |
| 只读项目 HTTP 更新 | 通过 | PUT /api/tasks/TASK-1?workspace=b 返回 403 |
| Workflow 目录选项的位置 | 通过真实 CLI | 顶层、workflow 后、config 后的 --workspace local 均返回 local 配置 |
| Workflow 深链接与真实答复 | 部分通过 | /workflow?workspace=local 正常渲染；页面 DOM 点击保存后 rq 台账新增 E2E-DECISION response；Saved yes，其他接续事实 unknown |
| 最新组合回归 | 51 通过、0 失败、176 断言 | 注册表、MCP 路由、HTTP 路由、rq 适配器、迁移、缓存、网页选择器和人工收件箱共 8 个文件；显式设置真实 BACKLOG_RQ_PATH，协调者独立重跑 |
| 完成与生命周期门禁 | 14 通过、0 失败、33 断言 | workflow-gate 与 workflow-gate-entrypoints；Python 协议 fixture 验证 CLI/HTTP/MCP、批量、降为草稿及终态提升，不冒充真实 rq G4 集成证明 |
| Workflow 目录选项实际写入 | 通过隔离 CLI | 从 git-a 上下文禁用再启用 local；中间值正确，源码及 git-a/git-b 配置 SHA256 均不变 |
| 原生终端基础操作 | 部分通过 | 实际 80×24 PTY 显示中文 TASK-1 [local]；? 打开帮助、Escape 返回、Enter 打开中文详情、q 正常退出 |
| 原生终端真实答复 | 通过隔离台账保存 | Ctrl+G 打开人工收件箱，Enter 输入中文答复，提交 E2E-TUI-ANSWER 后显示 Response saved；rq 回报投递 pending，不表示会话已执行；Escape 返回看板 |
| 网页导航、收件箱、CLI 与只读回归 | 31 通过、1 失败、124 断言 | 新一轮独立四文件测试；失败是只读目录的 doc list 别名被拦截，已交回修复，不视为整组通过 |
| 迁移与只读修复复验 | 26 通过、0 失败、90 断言 | 显式真实 BACKLOG_RQ_PATH；含实际迁移 API、rq board/card 与回退、并发目标保护、doc list 别名及 config 读写权限；关联材料 fixture 的任务身份精度仍待加强 |
| 跨项目 HTTP/MCP 与缓存复验 | 13 通过、0 失败、49 断言 | 包含实际 WebSocket 接收两个目录的外部文件编辑通知，真实 rq HTTP 答复、只读/失联路由与缓存代际竞争 |
| 真实终端人工核对 | 部分通过 | 原生 CLI 创建 TASK-2 和 E2E-TUI-CHECKS；Enter 在 M1/M2 未完成时阻止答复，1/2 逐项核对，m 展示中文材料，r 保留已勾选 M1；两项完成后中文答复保存，投递 pending |
| CLI 保存事实与目录选择复验 | 10 通过、0 失败、39 断言 | workflow-cli、web-workspace-switcher、workflow-inbox；不可核验时不返回 saved:false，错误请求身份与幂等重试均覆盖 |
| 迁移身份加强复验 | 27 通过、0 失败、97 断言 | 真实 rq；T-001 同身份 evidence/session、旧 source_key、任务数、台账字节及回退；自定义 Shipped 终态不重开历史 accepted |
| 会话事实与完成门禁复验 | 33 通过、0 失败、94 断言 | 网页收件箱 18 项及两个 gate 文件；含无人工请求的任务事实、原生 reasons、同号会话隔离、过期信号，以及真实 rq 低风险完成 |
| 聚合详情切换后实际写入 | 通过隔离网页与 HTTP 读取核验 | 从 all + taskWorkspace=b 切换 a，URL 清除旧任务范围；页面修改标题并失焦保存后仅 a 更新，b/local 标题保持原值；导航链接均保留 workspace=a |
| 类型与构建检查 | 当前通过 | 原生 tsc --noEmit 与 bun scripts/build.ts；后续 worker 改动仍需重验 |
| 原有用户项目审批台账 | 未创建测试批准 | 测试请求仅在系统 Temp 下演示项目创建 |

## 走查发现及修复跟踪

| 问题 | 状态 |
| --- | --- |
| 无目录参数时选择器显示全部、数据却是当前项目 | worker 已修正，等待重启服务后复验 |
| 单项目 Workflow HTTP 包装未解包，页面误认为无请求 | worker 已修正，等待真实页面复验 |
| rq agents 是对象而前端按数组使用 | worker 已修正，等待真实请求复验 |
| 材料接口顶层 content 与前端 data.content 不一致 | worker 已修正，等待复验 |
| /workflow 直接打开 404，/human-inbox 无前端匹配路由 | 重启服务后两条路径均通过真实页面复验 |
| 导航链接丢失 workspace 参数 | 真实页面仍发现 /board、/tasks 等链接未携带 local，已交回修正 |
| workflow 子命令的 --workspace 被忽略，配置写到当前目录 | 三种选项位置查询及隔离实际写入均通过；误写源码配置的三行已恢复，git diff 确认为空 |
| 保存/取消后已处理请求仍留在待办 | 新组件测试通过；重启后真实页面不再列出已答复 E2E-DECISION，即时提交刷新仍待新请求走查 |
| 模拟点击没有触发页面保存 | Orca click/key 操作未证明成功；DOM click 才触发实际保存，不视作鼠标/键盘走查通过 |
| 迁移中断和历史身份关联 | 两个 fixture 错误修复后实际迁移及回退通过；原始台账不变，rq board/card 仍可解析 T-001；同身份材料/会话关联与数量核对正在加强 |
| TUI 人工收件箱快捷键与里程碑过滤冲突 | 已改 Ctrl+G；实际终端可进入，中文答复保存通过；核对清单、刷新与恢复仍需验证 |
| TUI 人工收件箱键盘泄漏 | 新版本实测 n 不再穿透打开新建，Escape 返回看板；父面板绑定的其他快捷键仍有焦点风险，已交回修正 |
| 跨目录外部修改事件 | 子目录转发与多目录防抖已修复，实际 WebSocket 双目录外部编辑回归独立通过 |
| 请求与会话事实隔离 | 审查发现切换请求后可能展示上一请求保存结果，任务动作误用人工答复 action；已交回修正与回归 |
| TUI 只读人工操作 | 审查发现直接调用 rq 可绕过 Core 写权限；已要求在答复、取消、接续前重验目录权限 |
| TUI 请求方向键与长材料 | 实测方向键内部选项已变化但详情仍显示上一请求，材料超出 80×24 后无滚动入口；已交回修复 |
| TUI 刷新后的目录身份 | CLI 外部更新后 TASK-2 来源徽标消失，原始 Task 覆盖了 workspaceId；正在统一所有视图与 watcher 的复合身份 |
| 网页聚合详情切换项目 | 审查发现 taskWorkspace 残留可能使新目录下的任务操作仍定位旧目录；已交回增加切换与写入隔离回归 |
| 详情缺少目录身份导致会话串项目 | 真实编译版网页发现 b 的任务展示 local 的请求；HTTP 详情缺 workspaceId，正在补齐接口身份并加强前端歧义拒绝 |
| 终端重号任务返回后的选择 | 真实 PTY 发现 b 详情 Escape 后选中 a；只读 b 编辑正确拒绝，复合身份选择恢复正在修复 |
| 历史 Done 被新门禁冻结所有编辑 | 已交回修正；不能以历史状态认定当前批准 |

## 隔离环境

演示目录位于系统 Temp 的 `backlog-workbench-e2e-*`，使用独立 `BACKLOG_WORKSPACES_FILE`。其中两个目录包含独立 `.git`，一个为中文无 Git 目录；初始任务均为通过 CLI 分配的 TASK-1。项目 b 登记为只读。rq 通过显式配置调用，真实人工请求只写入演示项目。

Windows 外部 Chrome 操作因无法取得窗口焦点而未完成；独立浏览器进程启动被自动审核拦截。已改用 Orca 内嵌浏览器执行实际渲染与页面交互检查，不能将其写作已完成外部 Chrome 键盘走查。

网页验收使用 `bun scripts/build.ts` 生成的 `dist/backlog.exe` 启动服务。直接 `bun src/cli.ts browser` 在当前 Bun 1.3.10 环境返回空 HTML，不能拿源码启动的空白页判断已编译产品行为。网页填入与失焦保存通过 Orca fill 和页面 DOM blur 验证，不冒充完整物理鼠标/键盘走查。

## 尚待验证

- 完整物理桌面鼠标/键盘与窄屏走查；不能以 DOM save 或控件事件测试替代。
- 将原生任务创建、网页清单答复、同一绑定会话接续、材料失效与重新验收串为同一任务的可复现端到端用例；现有阶段证据分开记录。
- 最后刷新/监听故障提示补丁稳定后的类型、限定格式、相关回归及构建；整仓格式仍不满足 DOD。

整仓 Biome 检查目前失败（493 个文件中报告 461 个错误，包含未修改文件的 CRLF 格式差异）；没有批量改写行尾。完整 Bun 套件观察到 Windows 参数、Git 超时及环境相关失败，随后长时间停留在 MCP 阶段而无输出，协调者已终止挂起运行；不能统一归因为既有问题，也不能宣称全量通过。配置默认忽略部分 TSX 路径，限定文件的检查成功不等于这些组件已经接受格式检查。

rq 对普通 decision 的 answer 与 approve/allow 使用不同规则：实测答复草稿打开后修改任务材料，普通 answer 仍可按 rq 语义保存旧 response_revision；批准和授权必须通过当前版本校验。不能把普通答复保存当作旧版本已获批准。

本轮未提交、推送或发布。不以测试总数代替逐项验收，不以传输接受代替 Agent 完成，不以勾选清单代替审批。
