# 需求分析、Backlog 与 Workflow 统一流程

新需求使用统一的 Backlog 父子任务；Superpowers、OpenSpec、grill-me、to-spec 继续用于需求分析。旧任务不迁移。

完整操作手册位于共享 Workflow 的 [BACKLOG-FLOW.md](</C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/BACKLOG-FLOW.md>)，统一字段与产物规则见 [DOC-CONVENTIONS.md](</C:/Users/haifeng.ma/OneDrive/AI工具配置/workflow/DOC-CONVENTIONS.md>)。部署到其他机器时请随 Workflow 一并提供这两份文档；上述路径是本机位置。

```text
分析工具 → 规格与决定 → Backlog 父任务 / 子任务
                                 ↓
                       rq 证据 / 请求 / 审批 / 接续
                                 ↓
                       Backlog 有效验收后完成
```

- 规格保留原工具的可用目录，任务通过 --ref / --doc 引用。
- CLI 分配实际任务号，--parent 表达归属，--dep 表达执行依赖；不手写任务文件。
- 验收条件只维护原生 --ac，rq 使用 A1、A2 关联版本绑定检查。
- 新工作不再创建 backlog/tickets；原 ticket 对应可独立执行的子任务，小修改可直接用独立任务。
- 父任务仍需整体验收，Done 和勾选不代替有效批准。

本机已提供 [backlog-intake skill](</C:/Users/haifeng.ma/.codex/skills/backlog-intake/SKILL.md>)，供分析结束或整理需求时调用。未安装 skill 的 Agent 可直接按上述文档完成同样流程。

多目录登记、Workflow 配置、网页和终端操作见 [多目录工作台指南](multi-workspace.zh-CN.md)。验证结果见 [本次调整记录](requirements-workflow-validation.md)。
