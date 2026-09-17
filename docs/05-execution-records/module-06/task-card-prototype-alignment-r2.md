# 任务卡：M06 网域管理原型对齐 R2（抽屉表单 + 8列治理 + 接入进度四态）

> 状态：draft → executing（2026-09-17 PM 确认范围后进入实施）
> 关联：决策 73/75/77/79（原型 v2.14/2.15 落版）、dev-feedback #8（弃两步态裁剪改四态）
> 轨道：Track A（原型为第一参照）
> 契约权威：`docs/05-execution-records/module-06/api-contract-snapshot.md`

## 目标

把 M06「网域管理」列表与登记/编辑表单对齐原型 v2.14 的交互形态，并落地 PM 最新决策（接入进度四态先行、不裁剪）。

## 范围与差异（原型 vs 现状）

| # | 项 | 原型要求 | 现状 | 处置 |
|---|----|---------|------|------|
| G1 | 登记/编辑容器 | `<Drawer width=720>`（字段>6 用抽屉，§8 交互选型表） | `<Modal width=560>` | 改 Drawer |
| G2 | 标题 | 双行：主文案 + 副文案「仅登记行政信息…」 | 单行 | 改双行 |
| G3 | 页脚 | `取消 / 确认登记｜保存`，主按钮受 `!canSubmit` 禁用 | `取消 / 提交` | 改 |
| G4 | 前置自检 | `FormSection`+`CenterDirectChoice`（字段 `center_direct`） | 独立 state + 手写 Radio | 改表单字段驱动 |
| G5 | 自检=能 | Callout(warning)「无需登记网域，请关闭本窗口」+关闭，**表单不展开**（决策79硬劝阻） | 仅 Alert，表单仍展开 | 改 |
| G6 | 自检=不能 | Callout(brand)「你正在登记采集节点域」+「什么是网域」就地展开 | 仅 Alert | 改 |
| G7 | 表单分组 | 四组 `FormSection`：行政信息/授权与分区/网络与描述 | 平铺 | 新增 FormSection |
| G8 | 条件渲染 | `(编辑 \|\| 自检=不能)` 才渲染表单主体 | 始终渲染 | 改 |
| G9 | 字段差异 | 登记归属(tenant_id 只读固定)、网络分区(zone_type)、网段(ip_cidrs)、状态(status)、接入方式联动 | 缺 ip_cidrs / status，接入方式未联动 | 后端补 ip_cidrs；status 复用现有 enable/disable；tenant 只读 |
| G10 | 列表列数 | 11→8（§9 列数治理）：网域ID/授权租户全量/网段/CIDR/描述/创建与更新时间下沉**详情抽屉**；授权租户行内最多2标签+N | 11 列(含网域ID列) | 8列 + 详情抽屉 |
| G11 | 接入进度列 | 四态点阵 + 当前态文字（v0.2 数据聚合，MVP 二态；PM 改为四态先行） | 两步态 Steps | 四态 + `access_step` 后端派生 |

## 后端改动（platform/admin/networkdomain + models）

1. **模型**：`NetworkDomain` 新增 `IPCIDRs []string`（`serializer:json`，json `ip_cidrs`）。
2. **create**：请求新增 `ip_cidrs`（可选，[]string）。`tenant_id` 保持服务端固定 `platform_admin`（安全红线，不接收客户端）。`status` 保持默认 enabled（行政启停走独立 enable/disable 接口，表单内不重复提供 status 编辑，避免双写冲突）。
3. **list/detail**：聚合返回 `has_online_agents`（已存在）基础上，新增派生 `access_step`(1..4)：
   - 1 已登记（有记录即 1）
   - 2 已纳管（`is_monitored`）
   - 3 节点已上线（`has_online_agents`，存在 EdgeAgent.status=online）
   - 4 已出数据（M09 生效配置信号，MVP 缺源 → 回落 3，注释标注 M09 补充）
   `access_step` 计算放 service 层，为旧版/前端兼容返回完整四态语义。
4. **单测**：create 携带 ip_cidrs 落库/回显；access_step 派生各档位。

## 前端改动（ui-custom/web）

1. **类型/API**：`NetworkDomain` 增 `ip_cidrs: string[]`、`has_online_agents?: boolean`、`access_step?: number`；`NetworkDomainCreateInput`/`UpdateInput` 增 `ip_cidrs`。
2. **DomainForm → DomainDrawer**：改 `Drawer`，双行标题，footer`取消/确认登记|保存`；新增 `FormSection`（品牌色竖条小标题组件）；前置自检 `center_direct` 走 Form 字段；自检=能→Callout(warning)+关闭+不展开表单；自检=不能→Callout(brand)+「什么是网域」就地展开；四组表单；`接入方式`联动自检结果只读展示。
3. **DomainsPage 列表**：8 列治理（网域名称/接入方式/接入进度/状态/登记归属/授权租户/网络分区/操作），网域ID/授权租户全量/网段/描述/创建更新时间下沉详情抽屉；授权租户行内最多2标签+N；`接入进度`四点阵+当前态文字（复用 `access_step`）；操作列唯一主按钮联动当前态。
4. **前端测试**：抽屉表单（自检=能硬劝阻关闭/表单不展开）、详情抽屉、接入进度列渲染、8 列治理。

## 验收

- `go test ./platform/admin/networkdomain/... ./platform/models/...` 通过
- `pnpm lint` / 抽屉与列表相关 vitest 通过
- 回归：既有 M06 决策 82 删除/禁用弹窗、R1 新增列（接入方式/接入进度）不回归