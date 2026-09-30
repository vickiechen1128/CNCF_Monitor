# prototype-designer 执行记录：module-08

## 任务

基于 `docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md` 生成分模块独立原型。

## 输出

- PRD 文件路径：`docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md`
- PRD 状态：ready
- PRD 版本：v1.1
- 原型目录：`docs/prototypes/module-08/`
- 对齐决策记录：`docs/05-execution-records/module-08/design-decisions.md`
- 技术缺口记录：无

## 原型页面清单

- 告警规则
- 规则组
- 静默规则
- 通知渠道

## 本地启动方式

```bash
cd docs/prototypes/module-08
pnpm install
pnpm dev
```

访问地址：http://localhost:5173/

## 验证结果

- `pnpm exec tsc --noEmit`：通过
- `pnpm run build`：通过
- `pnpm run lint`：通过

## 已知问题/下一步建议

- 原型阶段使用本地 mock 数据，未接入真实后端 API。
- 后续进入 feat/module-08 开发时，需冻结 PRD 并按 micro-task 序列执行。

---

## 评审记录：design-proposal `alert-route-frontend-editor.md`（2026-09-30）

> 评审身份：prototype-designer（PRD / 原型 Owner）
> 评审对象：`docs/05-execution-records/module-08/design-proposals/alert-route-frontend-editor.md`（草案 v0.1，P1–P7 已决）
> 输入：提案全文 + 当前 `module-08/dev-feedback.md`（#26 / #28 / #29 / #30）+ 已 landed 实现 + M08 PRD v1.17 + `api-contract-snapshot.md` §11.6
> **结论：修改后吸收（Approved with changes）** —— 主体吸收进 PRD v1.18；3 处口径需修正后落地；3 项范围外能力登记版本、不入本期正文。

### 一、事实核对（提案 ↔ 现状，逐条）

| 提案主张 | 核对结果 |
|---|---|
| PRD §7.1 已规定 MetricCenter 生成 `route` / `receiver`；「一期 route 由用户写」（#26）是过渡退让，本提案属「补实现」而非「改职责」 | ✅ 属实（PRD §7.1「通知路由：生成 `alertmanager.yml` 的 `route` / `receiver`」；#26 为过渡裁决） |
| 平台当前只物化 `receivers`，`route` 不触碰 | ✅ 与 #28 L3 landed 文案一致 |
| 原型 `RoutesPage.tsx` 已存在、信息架构已验 | ✅ 文件存在；但 PRD §11 页面矩阵仅 4 页、未含「路由规则页」→ 需补 §11.7 |
| #28 L1 / L2 / L3 已 landed | ✅ L2 =「平台命名空间」判据，与提案 §4.4 `receivers` 行一致 |
| #29 / #30 已 landed（模板去重收窄 + 渠道↔模板绑定） | ✅ 与提案 §4.9 适用维度（receiver 是否平台托管）**不冲突、可组合**：#30 管「渠道用哪个模板」，§4.9 管「receiver 有没有 route 兜底」 |

### 二、逐项结论（吸收口径）

| 提案条目 | 结论 | PRD 落点 |
|---|---|---|
| route 前台化方向（信息架构 + §5.2 全 12 字段控件映射） | **吸收** | §1 / §3.1 / §11.7 |
| 分期细化 v0.3-a（只读渲染）/ v0.3-b（表单可写）/ v0.3-c（联动）/ v1.0 | **吸收** | §1 / §2（M08-OPS-02）/ §3.1 |
| route 段「单一作者 + 模式开关」（方案 B），否掉「分区受管」（方案 C） | **吸收** | §4.1（新增 4.1.1）/ §5.2 / §7.1 |
| `receivers` 双作者命名空间判定（= L2） | **吸收** | §4.1 / §7.1 |
| §4.9 最小运行骨架自动布缆（新建渠道开箱即响 + 默认接收人） | **吸收（关键，优先落地）** | §3.1 / §4.1.1 / §11.6 |
| 编辑态字段 vs 落盘字段（`id`/`parent_id`/`name`/`order`/`enabled` 不落盘；`name` 以注释落盘） | **吸收** | §5.2 |
| 「从当前配置导入」 | **修改后吸收** | §11.7（降级为「导入 + 手动校正」，不设「逐字往返无损」硬门槛） |
| 逃生门永久保留（整份文件挂载） | **吸收** | §4.1 / §11.6 |
| 排序交互：拖拽取代 `order` 数字框 | **吸收**；`order` 保留为编辑态辅助字段 | §5.2 / §11.7 |
| 术语映射补充（路由/匹配条件/分组键/发送节奏等） | **吸收** | §10 |
| 验收标准 9 条 | **吸收（按版本标注）** | §9.1 / §9.2 |

### 三、需修正的 3 处口径（修改后吸收）

1. **C1 · L3 文案过渡**：#28 L3 已 landed 的文案「平台只负责 `receivers`，`route` 由用户写并引用」是**过渡态**。PRD 口径改为「`route` 默认由用户手写、可切换为平台管理；平台为托管 receiver 注入最小根兜底骨架」；#26「一期 route 由用户写」在 PRD 中标注为**过渡裁决（已被本提案取代）**。落地时前端 L3 文案按提案 §4.9 同步改写（属 feat 侧动作，不在本次 PRD 回写内）。
2. **C2 · route 生成归属需分层**：提案 P5 称「route 生成在前端（表单→YAML）」，§4.9 又要求生成器注入骨架——**二者不矛盾但须写清**：**具体分流 `route.routes[]`（带 matchers）= 前端表单生成；根兜底 `route.receiver` 骨架 = M09 生成器注入**（平台模式并入生成树 / 手写模式经 `route_files` 合并平台片段）。PRD 按此分层表述，消除「route 到底谁生成」歧义。
3. **C3 · 「默认接收人」与 PL-2「告警配置三块必写」协调**：`alert-config-scope-and-notification-bridge.md` PL-2 规定告警配置页用户需写 `receivers` / `route` / `inhibit_rules` 三块；本提案引入「默认接收人」配置项与模式开关。统一表述为：**告警配置页（文件挂载）= 逃生门 + 模式开关 + 默认接收人落点；route 内容默认手写（PL-2 口径不变），开启平台管理后由平台生成**。二者不冲突。

### 四、范围外（登记，不入本期 PRD 正文）

| 能力 | 处置 |
|---|---|
| `mute_time_intervals` / `active_time_intervals`（免打扰时段） | v1.0 候选（不承诺） |
| 路由影响预测模拟器（「这条告警会走哪条路由」） | v0.3+ 候选 |
| 死规则检测（某条路由条件被上方兄弟完全覆盖） | v0.3-c 候选 |

### 五、PRD 回写执行结果（v1.17 → v1.18）

- 已按上表将获准内容吸收进 `docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md`：§0（补阶段 6）/ §1 / §2（M08-OPS-02）/ §3.1 / §4.1（新增 4.1.1）/ §5.2 / §7.1 / §9 / §10 / §11.1 / §11.6 / 新增 §11.7 / Change Log。
- 提案 `alert-route-frontend-editor.md` 状态改 `merged`，头部标注吸收版本。
- **不在 design 分支新增 dev-feedback 条目**（按项目约定，M08 `dev-feedback.md` 以 `feat/*` 为唯一权威写入点）；#26 的「过渡裁决」标注以 PRD 正文为准。
- **待跟进（非本次 PRD 范围）**：原型 `docs/prototypes/module-08/src/pages/RoutesPage.tsx` 细化（拖拽排序 / 根路由置顶锁定 / 模式徽标 + 导入入口 / 编辑 Modal→Drawer 三段式 / 整除与 timeout 提示 / mock 保存改「生成 YAML 预览」）——属原型增量，另行排期。
