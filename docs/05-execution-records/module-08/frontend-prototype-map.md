# 原型 ↔ 生产 映射表：Module\_08 告警收敛与通知管理

> 依据 `frontend-developer.md` Step 3.5 六项核对，解决「原型视觉 / 列 / 入口与生产实现断层」问题。
> 本表作为 L3 规划与前端代码 review 的逐项勾验载体，反向从 `docs/prototypes/module-08` 与 `ui-custom/web/src/pages/alerts` 生成。
> 覆盖范围：前端 T08-F1 \~ T08-F5（告警配置页 / 静默页 / 顶级 tab「告警收敛与通知管理」/ 两条路由 / alertmanager 契约类型与 API client / 决策 55/59/60）。
>
> 后端契约对账源：`docs/05-execution-records/module-08/api-contract-snapshot.md` 与决策 55/59/60（PRD v1.7）。

## 一、决策落版

| 决策            | 选择            | 落地说明                                                                                                                                                                                                            |
| ------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 视觉还原       | **a 强制**      | 复用全站火山引擎 Token（原型 `module-08/src/theme.ts` 与 `module-07` 一致）：主色 `#0ECDEB`、头部 `#0B1B2A`、内容背景 `#F7F8FA`。生产 `src/theme.ts` 已全局注入，告警页无独立新 Token。                                                                    |
| D2 原型定位       | **a 实现基底**    | 复制原型 `ConfigPage`（文件挂载）与 `SilencesPage`（静默极简 UI）的结构 / 列集合，替换 mock 为真实 alertmanager API；其余原型页（告警状态四态 / 通知渠道 / 路由 / 抑制）按决策 55/59 裁剪（见「六、裁剪清单」）。                                                                   |
| D3 顶级 tab 模块名 | **a PRD 模块名** | 顶部一级 tab 用 PRD 模块名「告警收敛与通知管理」（`MainLayout` MODULES `alert`），不用功能页名「告警配置」；功能页名下沉为 Sider 二级「告警配置 / 静默管理」。                                                                                                         |
| D4 MVP 交付形态   | **b 文件挂载承载**  | 决策 55/59：接收人 / 路由 / 抑制不走字段化表单 UI（归 v0.3/v1.0），统入整份 `alertmanager.yml` 文件挂载 + amtool check-config 校验 + 内容侧留痕；静默走 Alertmanager API 直调（即时生效，不进 M09 变更单）。决策 60：挂载产物作为管理域 scope 配置进入 M09 ConfigDraft 人工确认后下发 reload。 |
| D5 契约类型与客户端   | **a 独占新建**    | `src/types/alertmanager.ts` 为 M08 前端独占类型出口；`src/api/alertmanager.ts` 封装 配置版本 / 静默 / 校验 相关 API；常量收敛到 `src/pages/alerts/alertmanagerConstants.ts`（silence 状态色、config 状态色、matcher 格式化、跨模块跳转路径）。                    |
| D6 跨模块协作      | **a M09 为准**  | 配置「下发状态」以 M09 变更单回写为准（决策 60 管道 Owner=M09），M08 仅内容侧留痕；M08 挂载提交后 message 引导跳转 `/config-preview`（M09）。                                                                                                             |

## 二、文件级映射

| 原型文件（`docs/prototypes/module-08/src/`）                               | 生产对应（`ui-custom/web/src/`）                                                                              | 处理               | 核对项          | 说明 / 理由                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `theme.ts`                                                           | `src/theme.ts`                                                                                          | **复制**           | D1 视觉还原      | 火山引擎 Token 已全站迁移（与 module-07 同源），告警页复用。                                                                                                                                                                                                                                              |
| `App.css`                                                            | `src/App.css`                                                                                           | **复制 + 裁剪**      | D1 / D3      | 深色头部、内容背景、AWS 顶部 tab 下划线保留；移除原型 `.page-header`/`.page-card` 等页面级样式（改组件内联/Card 默认）。                                                                                                                                                                                                   |
| `layouts/MainLayout.tsx`                                             | `src/layouts/MainLayout.tsx`                                                                            | **复制 + 裁剪**      | D3           | 移除原型角色切换 Select / 网域模式 Switch / 「原型验证版」Tag 等脚手架；保留 Header 一级 tab + Sider 二级导航。**新增**顶级模块 `alert`「告警收敛与通知管理」→ Sider 二级「告警配置 `/alert-config` / 静默管理 `/silences`」（T08-F4，commit `1f18cc94`）。                                                                                            |
| `App.tsx`                                                            | `src/App.tsx`                                                                                           | **复制 + 裁剪**      | 1 路由         | 生产注册 `/alert-config`（AlertConfigPage）、`/silences`（SilencesPage）两条路由（懒加载，T08-F4 commit `1f18cc94`）。                                                                                                                                                                                   |
| `pages/ConfigPage.tsx`                                               | `src/pages/alerts/AlertConfigPage.tsx` + `AlertConfigDrawer.tsx` + `useAlertConfig.ts`                  | **复制 + 拆分 + 替换** | 2 / 3 / 4    | 原型单文件（挂载/校验/版本历史/回滚/跨模块跳转）按 T08-F2 拆为：页面壳 `AlertConfigPage.tsx`（当前生效 + 版本历史 + 详情 Drawer）、`AlertConfigDrawer.tsx`（Upload/粘贴 + amtool 校验 + 提交）、`useAlertConfig.ts`（数据 Hook：current/versions/remount）。**mock 替换为** `alertmanagerConfigApi` 真实调用；校验行为由原型前端正则模拟改为后端校验失败行级错误不落库（决策 59/60）。 |
| `pages/SilencesPage.tsx`                                             | `src/pages/alerts/SilencesPage.tsx` + `CreateSilenceDrawer.tsx` + `useSilences.ts`                      | **复制 + 拆分 + 替换** | 2 / 3 / 4    | 原型 Modal 新建表单拆为独立 `CreateSilenceDrawer.tsx`（T08-F3）；列出独立 `SilencesPage.tsx` + `useSilences.ts`。**mock 替换为** Alertmanager API 直调（创建/列表/删除即时生效）；新增决策 56 授权提示 + 决策 59「不进 M09 变更单」说明、越权创建被拒展示。`dayjs` 新增依赖（T08-F3）。                                                                      |
| `pages/AlertStatusPage.tsx`                                          | —（无）                                                                                                    | **删除（独立页）**      | 3 导航 IA / 裁剪 | 「告警状态四态页」（active/silenced/inhibited/unprocessed）决策 55 标注归 v0.3/v1.0，MVP 裁剪（见「六、裁剪清单」）。                                                                                                                                                                                               |
| `pages/NotifiersPage.tsx` / `RoutesPage.tsx` / `InhibitionsPage.tsx` | —（无）                                                                                                    | **删除（独立页）**      | D4 裁剪        | 通知渠道 / 路由规则 / 告警抑制的字段化编辑 UI 归 v0.3/v1.0，MVP 由整份 `alertmanager.yml` 文件挂载承载（决策 59）。                                                                                                                                                                                                    |
| `mocks/module-08.ts`                                                 | `src/api/alertmanager.ts` / `src/types/alertmanager.ts` / `src/pages/alerts/alertmanagerConstants.ts`   | **替换**           | 4 数据契约       | mock 类型（Matcher / Silence / AlertmanagerConfigVersion / ChangeStatus / NotificationStatus 等）落到 `types/alertmanager.ts`；mock 数据替换为真实 API。                                                                                                                                             |
| `components/StageBadge.tsx`                                          | —（无）                                                                                                    | **删除**           | 实现基底裁剪       | 原型阶段角标，不进入生产。                                                                                                                                                                                                                                                                        |
| —                                                                    | `src/api/alertmanager.ts`                                                                               | ➕生产新增            | 4            | M08 前端 API 客户端：配置版本（current/versions/remount）、静默（create/list/delete）、校验错误载体（T08-F1/F2）。                                                                                                                                                                                              |
| —                                                                    | `src/types/alertmanager.ts`、`src/pages/alerts/alertmanagerConstants.{ts,test.ts}`、`alertSmoke.test.tsx` | ➕生产新增            | 4 / 验证       | 类型、枚举/常量、端到端冒烟测试（T08-F1/F5）。                                                                                                                                                                                                                                                         |

## 三、表格列 / 区块对照

### 3.1 告警配置 / 当前生效配置与版本历史（原型 `ConfigPage.tsx` vs 生产 `AlertConfigPage.tsx`）

| #  | 原型列 / 区块                           | 生产现状                      | 处理 | 理由                                                                                                                                        |
| -- | ---------------------------------- | ------------------------- | -- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | 当前生效配置 只读 YAML 预览                  | ✅ 已有                      | 对齐 | 生产仅展示当前已挂载生效 content；空态提示「点击挂载新配置」。                                                                                                       |
| 2  | 当前生效配置 标题 Tag（版本/提交人/变更待确认/已下发生效）  | ⏭️ 部分实现                   | 替换 | 生产 `Card` title 仅展示「生效于 applied\_at 由 applied\_by 提交」（`current`）；M09 回写下发状态 Tag 检测由后端 current 状态 + 变更单联动，MVP 以版本历史「M09 变更单」列承载。           |
| 3  | 版本历史列「版本」（`v4`）                    | ✅ 已有                      | 替换 | 生产列头「版本 ID」（后端 `id`，`Text code`），非原型 `version` 序号。                                                                                        |
| 4  | 版本历史列「校留痕状态（当前内容/已留痕）」             | ✅ 已有（均值 applied）          | 对齐 | 决策 59/60：校验失败不落库 → 生产 `status` 仅 `applied`，`configStatusLabel` 展示。                                                                        |
| 5  | 版本历史列「下发状态（M09 回写）」                | ✅ 已有                      | 对齐 | 生产独立「M09 变更单」列（`source_change_no` `Text code` / `-`）；下发状态以 M09 为准（决策 60）。原型用 `renderChangeStatus` 展示 pending/confirmed/deployed/rejected。 |
| 6  | 版本历史列「提交时间」                        | ✅ 已有                      | —  | 生产「生效时间」（`applied_at`）。                                                                                                                   |
| 7  | 版本历史列「操作人」                         | ✅ 已有                      | —  | 生产「应用人」（`applied_by`）。                                                                                                                    |
| 8  | 版本历史列「校验和（sha256 截断）」              | ✅ 已有                      | 对齐 | `shortChecksum` 复用。                                                                                                                       |
| 9  | 版本历史列「操作（查看）」                      | ✅ 已有（➕重新挂载）               | 对齐 | 生产「查看」打开详情 Drawer，并新增「重新挂载此版本」（回滚=重新校验+提 M09，Modal 二次确认 + 行级错误列表）。                                                                        |
| 10 | 挂载抽屉：Upload/粘贴 整份 alertmanager.yml | ✅ 已有（`AlertConfigDrawer`） | 对齐 | 上传自动带出展示名、可粘贴；校验错误行级展示。                                                                                                                   |
| 11 | 挂载抽屉「校验配置（amtool check-config）」    | ✅ 已有                      | 替换 | 原型前端 `checkAlertmanagerYaml` 正则模拟；生产调后端校验，返回行级 `ValidateErrorItem[]`（决策 59 校验失败不落库）。                                                      |
| 12 | 挂载抽屉「提交并进入变更确认」+ 跳 M09             | ✅ 已有                      | 对齐 | 生产提交成功后 message 引导 `navigate('/config-preview')`（决策 60）。                                                                                  |
| 13 | 页面顶部「配置变更路径」说明条                    | ⏭️ 简化                     | 替换 | 生产以 `.page-header` 副标题文字（文件挂载→M09 确认→reload）承载，不再铺全宽说明条。                                                                                  |

### 3.2 静默管理页列（原型 `SilencesPage.tsx` vs 生产 `SilencesPage.tsx`）

| #  | 原型列                                         | 生产现状                        | 处理 | 理由                                                                                |
| -- | ------------------------------------------- | --------------------------- | -- | --------------------------------------------------------------------------------- |
| 1  | Matchers（`name="value"` 文本）                 | ✅ 已有                        | 对齐 | 生产 `formatMatchers` 复用 + `EllipsisText`。                                          |
| 2  | 开始时间                                        | ✅ 已有                        | —  | 生产「生效时间」（`starts_at`）。                                                            |
| 3  | 结束时间                                        | ✅ 已有                        | —  | 生产「失效时间」（`ends_at`）。                                                              |
| 4  | 状态（active/pending/expired Tag）              | ✅ 已有                        | 对齐 | `silenceStatusColor/Label` 对齐原型 生效中/待生效/已过期。                                      |
| 5  | 创建者                                         | ✅ 已有                        | —  | 生产「创建人」（`created_by`）。                                                            |
| 6  | 备注                                          | ✅ 已有                        | —  | 生产「原因」（`comment`，EllipsisText）。                                                   |
| 7  | 操作（删除 Popconfirm）                           | ✅ 已有                        | 替换 | 生产用 `Modal.confirm` 二次确认（决策 59 删除即调 AM API 失效）。                                   |
| 8  | 新建静默 Modal（matchers JSON / 时间范围 / 创建者 / 备注） | ✅ 已有（`CreateSilenceDrawer`） | 替换 | 生产改为独立 Drawer 表单（匹配条件 + 生效时间 + 备注，发布人沿用当前登录账号），提交→ `useSilences.create` → AM API。 |
| 9  | —                                           | ➕生产新增                       | —  | 静默状态筛选（全部/生效中/待生效/已过期）+ 关键词筛选（`FilterBar`）。                                       |
| 10 | —                                           | ➕生产新增                       | —  | 决策 56 授权提示 Alert「静默影响当前授权网域」；越权创建被拒展示服务端错误；覆盖 空态/接口错误/权限不足。                       |

## 四、导航与 IA 模型

### 4.1 顶部一级 tab（Header）

| 原型 / PRD 模块名  | 生产实现                                   | 备注                                        |
| ------------- | -------------------------------------- | ----------------------------------------- |
| 首页            | `home` → `/`                           | 占位。                                       |
| 系统与平台管理       | `platform-admin` → `/admin/domains`    | M06。                                      |
| 监控对象管理        | `monitoring-object` → `/resources`     | M07。                                      |
| 采集策略          | `monitoring-strategy` → `/collectors`  | M01/M04。                                  |
| 网域与边缘配置中心     | `config-center` → `/domain-onboarding` | M09。                                      |
| **告警收敛与通知管理** | `alert` → `/alert-config`              | **D3：PRD 模块名**（T08-F4，commit `1f18cc94`）。 |

### 4.2 Sider 二级入口（当前模块：告警收敛与通知管理）

| 目标入口 | 路径              | 生产现状  | 备注              |
| ---- | --------------- | ----- | --------------- |
| 告警配置 | `/alert-config` | ✅ 已实现 | Sider 选中态与路由联动。 |
| 静默管理 | `/silences`     | ✅ 已实现 | —               |

### 4.3 原型 Sider 中 MVP 未承载的独立入口（决策 55/59 裁剪）

| 原型 Sider 项           | 生产现状  | 备注                                   |
| -------------------- | ----- | ------------------------------------ |
| 告警状态（`/alerts`）      | ❌ 未注册 | 四态页归 v0.3/v1.0（决策 55）。               |
| 路由规则（`/routes`）      | ❌ 未注册 | 字段化 UI 归 v0.3/v1.0，MVP 走文件挂载（决策 59）。 |
| 通知渠道（`/notifiers`）   | ❌ 未注册 | 同上。                                  |
| 告警抑制（`/inhibitions`） | ❌ 未注册 | 同上。                                  |

## 五、视觉 Token 清单

与全站 `src/theme.ts` 共用同一套火山引擎 Token（原型 `module-08/src/theme.ts` 内容与 module-07 一致）：

| Token       | 值         | 用途                   | 来源文件                                     |
| ----------- | --------- | -------------------- | ---------------------------------------- |
| 主色（Primary） | `#0ECDEB` | 主按钮、选中态、链接高亮         | `src/theme.ts` `colorPrimary`            |
| 主色背景浅       | `#E6FAFD` | 选中卡片背景、hover 背景      | `src/theme.ts` `colorPrimaryBg`          |
| 头部深色        | `#0B1B2A` | Header 背景            | `src/theme.ts` `colorHeaderBg` / App.css |
| 成功色         | `#00B578` | 生效中 / 已下发            | `src/theme.ts` `colorSuccess`            |
| 警告色         | `#FA8C16` | 待生效 / 待确认 / 已下发未采到   | `src/theme.ts` `colorWarning`            |
| 错误色         | `#FF4C3A` | 已拒绝 / 删除 / 校验失败      | `src/theme.ts` `colorError`              |
| 信息蓝         | `#1481FD` | 链接 / 信息提示            | `src/theme.ts` `colorInfo`               |
| 页面背景        | `#F7F8FA` | Content 背景 / YAML 预览 | `src/theme.ts` `colorBgBase`             |

## 六、裁剪清单（原型中有但 MVP 生产未保留）

| 原型项                                             | 生产处理        | 理由                                                                  |
| ----------------------------------------------- | ----------- | ------------------------------------------------------------------- |
| 告警状态四态页（active/silenced/inhibited/unprocessed）  | 裁剪          | 决策 55：告警状态页归 v0.3/v1.0「告警域工作台」，MVP 不展开。                             |
| 通知渠道 / 路由规则 / 告警抑制 字段化编辑 UI                     | 裁剪，统入文件挂载   | 决策 55/59：接收人/路由/抑制以整份 `alertmanager.yml` 挂载承载，字段化表单 UI 归 v0.3/v1.0。 |
| 角色切换（ops/arch Select）+ 网域模式 Switch + 「原型验证版」Tag | 删除          | 原型脚手架，不进入生产（单租户 / M09 处理网域）。                                        |
| `StageBadge` 阶段角标                               | 删除          | 原型产物。                                                               |
| `mock/module-08.ts` 全量 mock                     | 替换为真实 API   | MVP 必须对接后端（配置版本 / 静默 / 校验）。                                         |
| 前端 `checkAlertmanagerYaml` 正则校验                 | 替换为后端行级校验   | 决策 59：amtool check-config 等价校验后端执行，校验失败不落库、仅返回行级错误。                 |
| 原型「配置变更路径」全宽说明条                                 | 简化为主区内文字说明  | 避免与主页面文件挂载语义重复。                                                     |
| Silences 表单手填「创建者」                              | 简化为沿用当前登录账号 | 与 M06 登录身份对齐，不信任前端传人。                                               |

## 七、开发验证待办清单

- [ ] D1：确认告警页复用全站 `#0B1B2A` 头部 / `#0ECDEB` 主色，无 antd 默认 `#1677ff` 残留。

- [ ] D3：确认 `MainLayout` 顶部一级 tab 文案为「告警收敛与通知管理」；Sider 二级为「告警配置 / 静默管理」。

- [ ] 路由：确认 `src/App.tsx` 注册 `/alert-config`、`/silences`；未注册 四态/路由/渠道/抑制 相关路由（与裁剪一致）。

- [ ] 告警配置：当前生效只读预览、版本历史（版本 ID/状态/生效时间/应用人/M09 变更单/校验和/操作）、挂载抽屉（上传/粘贴/行级校验错误/提交 M09 跳转）、重新挂载回滚（Modal 二次确认 + 行级错误列表）正常。

- [ ] 静态挂载端到端：后端校验失败不落库（无新版本条目）并返回行级错误；通过后生成 M09 变更单，消息引导跳 `/config-preview`。

- [ ] 静默管理：创建/列表/删除即时生效（AM API）；状态筛选 + 关键词筛选；决策 56 授权提示与越权被拒服务端错误展示。

- [ ] 权限/错误状态：覆盖告警配置 / 静默 的 加载中、空态、接口错误、`permissionDenied` 空态矩阵。

- [ ] `alertSmoke.test.tsx` 端到端冒烟 + `MainLayout.test.tsx` 顶级 tab / 激活态 / Sider 联动通过。

- [ ] 全局：`make test-platform` + 前端 `pnpm test` / `pnpm lint` 通过；后端 run + 前端 dev 200，T08-F1\~F5 主链路走通。

- [ ] TODO：四态页 / 通知渠道 / 路由 / 抑制字段化 UI 是否在 v0.3/v1.0 回归，届时据此表补列模块与路由。

