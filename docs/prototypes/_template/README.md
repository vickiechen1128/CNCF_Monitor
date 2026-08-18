# MetricCenter 原型模板（_template）

> 本目录是所有模块原型的**复制源**，不是可独立运行的应用。
> 新模块或存量模块改造时，从这里复制组件骨架，再填充业务内容。

## 包含内容

| 文件 | 用途 |
|------|------|
| `src/contexts/ReviewNotesContext.tsx` | 评审说明全局开关（localStorage 持久化，默认关闭） |
| `src/components/ReviewNote.tsx` | 评审说明统一容器（灰底虚线框、默认折叠、受开关控制） |
| `src/components/ReviewNoteSwitch.tsx` | MainLayout 右上角「评审说明」开关 |
| `src/components/EllipsisText.tsx` | 长文本截断 + 悬浮全文（对应前端标准第 9 章） |
| `src/components/FilterBar.tsx` | 筛选区栅格布局（FilterBar + FilterItem），替代 `<Space wrap>` 堆叠 |
| `src/components/tablePresets.ts` | 表格统一样式：横向滚动、分页、操作列固定 |
| `src/layouts/MainLayout.tsx` | 标准布局骨架：Provider + Switch + 菜单 + 页面级 ReviewNote 槽位 |

## 使用方式

1. 复制 `src/` 下的组件到模块原型对应目录；
2. `package.json` 增加检查脚本：
   ```json
   "check:notes": "bash ../../../scripts/check-prototype.sh module-XX --markers-only",
   "check:prototype": "bash ../../../scripts/check-prototype.sh module-XX"
   ```
3. 提交前运行 `pnpm check:prototype`，泄漏必须清零，结构警告应清零。

## 页面硬规则（与 02_Frontend_Standard.md 第 8-10 章一致）

- 用户主区最多 1 个用户级 `Alert`（蓝色说明性 Alert 一律进 `ReviewNote` 或删除）；
- 空态用 `Empty` / `Table locale.emptyText`，不用 `Alert`；
- 表格列数 ≤ 8，超出部分下沉详情 Drawer；列数多时必须 `scroll={{ x: 'max-content' }}` + 主标识列 `fixed: 'left'` + 操作列 `fixed: 'right'`；
- 文本列默认截断 + 悬浮全文（用 `EllipsisText`），禁止散点手写 `maxWidth`；
- 筛选条件用 `FilterBar` 栅格布局，超过 4 组自动整齐换行，禁止 `<Space wrap>` 堆叠；
- 评审说明 / 设计依据一律进 `ReviewNote`，用户可见文案不得出现决策编号、PRD 引用、版本标记。
