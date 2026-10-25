# module-00 dev-feedback

> 记录基础设施 / 仓库流程 / 工具链层面的反馈与处置。

## F-1：外部 Markdown 格式化工具改写全局架构 PRD（2026-10-25，已还原）

- **现象**：`docs/02-product-requirements/00_Global_Architecture.md` 在工作区出现 92 增 / 89 删的 diff；逐行核对后确认**全部为 Markdown 格式化，正文语义未变**：
  - 表格分隔行与单元格补空格对齐；
  - 下划线 / 波浪线转义（`Module_04` → `Module\_04`、`10GB~50GB` → `10GB\~50GB`）；
  - 分隔线 `---` → `***`；
  - 引用行尾追加硬换行 `\`；
  - 粗体被拆成 `**biz_code** **/** **biz**` 形式。
- **影响**：PRD 目录被代码侧编辑器 / Agent 的 format-on-save 改写，产生无意义 diff、污染提交范围；若误提交会与 design 条线的文档维护冲突（目录隔离规则：`docs/02-product-requirements/` 归 prototype-designer / chenrt）。
- **处置**：`git checkout -- docs/02-product-requirements/00_Global_Architecture.md` 还原到 HEAD；本次只提交本 feedback 记录，不带入任何格式化改动。
- **建议**：在编辑器 / Agent 的格式化配置中排除 `docs/02-product-requirements/**`（以及 `docs/prototypes/**`）；如需统一 Markdown 风格，先由 design 条线定规则，再对 PRD 做一次性格式化并单独提交。
- **关联**：该文件 mtime 为 2026-10-23 16:48（非本轮改动）；同批工作区还出现 `metric_center.db.bak-*` 备份与 `upstream/alertmanager` 子模块未跟踪状态，均已排除在提交之外。
