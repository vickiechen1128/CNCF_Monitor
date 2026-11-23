# 系统与平台管理（含多租户） 场景链接矩阵（Scenario Link）

> **状态**：draft（骨架已建，待场景走查）
> **Domain ID**：`DOMAIN-SYS-MGMT`
> **SRS**：[Module_06_Multi_Tenant_Requirements.md](../02-product-requirements/Modules/SRS/Module_06_Multi_Tenant_Requirements.md) v1.5
> **HLD**：[Module_06_System_and_Platform_Management_High_Level_Design.md](Module_06_System_and_Platform_Management_High_Level_Design.md) v1.1
> **演示脚本**：`docs/05-execution-records/module-06/scenario-walkthrough.md`（待创建）
> **对外验收说明书**：`docs/07-design/Module_06_Acceptance.md`（待创建，派生，非追溯）
> **需求 Owner**：chenrt　**技术 Owner**：待指定
> **说明**：本表是双方唯一链接点；SRS/HLD 不再各自维护第二份追溯表。

---

## 1. 能力图例（技术内部）

| CAP | 意图 | 实现 |
|-----|------|------|
| CAP-AUTH-SESSION | 登录、会话、限流、改密、登出失效 | foundation / auth |
| CAP-AUTHZ | 两级角色门（admin / user） | foundation |
| CAP-TENANT | 租户台账、状态、多网域开关 | m06 |
| CAP-DOMAIN-ADMIN | 网域行政字段、登记/编辑/禁用 | m06 |
| CAP-DOMAIN-RETIRE | 引用检查 + 级联清退 Token/纳管 | m06 → m07/m09 |
| CAP-CLOUD-DICT | 云字典只增维护与停用保护 | m06 |
| CAP-STORAGE | TSDB 保留策略读写与生效提示 | m06 |
| CAP-UI-ADMIN | 管理后台页面 | ui-custom/web |

---

## 2. 场景链接矩阵

> 「验收结论」枚举：`—`（未走查）/ `pass` / `partial` / `failed`；与对外验收说明书映射：`pass → 通过`、`partial → 有条件通过`、`failed → 不通过`。

| SCN | 覆盖 FR/NFR | 验收（需求方语言） | 技术实现（CAP / mXX） | HLD 章节 | 演示 | 需求方反馈 | 验收结论 |
|-----|-------------|--------------------|------------------------|----------|------|------------|----------|
| SCN-01 新网络域接入监控 | FR-06、FR-08、FR-09；NFR-11、NFR-12 | 登记信息完整；提示必须走采集节点；可直达纳管安装；进度四态可见 | CAP-DOMAIN-ADMIN / CAP-CLOUD-DICT / CAP-UI-ADMIN；m06/m09 | §4.2、§6.4、§6.5、§7.2 | SCN-01 | 待走查 | — |
| SCN-02 为业务团队授权网域 | FR-01、FR-02；NFR-03、NFR-07 | 授权集合生效；租户用户仅见被授权网域；登记归属不变 | CAP-TENANT / CAP-AUTHZ；m06 + m09 查询注入 | §4.2、§6.3、§9 | SCN-02 | 待走查 | — |
| SCN-03 回收下线网域 | FR-07；NFR-08 | 有引用被拒绝并给清单；无引用软删并级联清退；节点凭据废止 | CAP-DOMAIN-RETIRE；m06 → m07/m09 | §4.2、§6.4、§7.3、§8.1 | SCN-03 | 待走查 | — |
| SCN-04 调整中心存储保留策略 | FR-10；NFR-12 | 保存即写入；期望值/运行时可比对；提示待重启且无越权重启 | CAP-STORAGE；m06 | §4.2、§6.6、§7.5 | SCN-04 | 待走查 | — |
| SCN-05 新同事入职与离职 | FR-03~05、FR-11；NFR-04~06 | 账号可用；禁用即失效会话；admin 不可删；登录日志可筛 | CAP-AUTH-SESSION / CAP-AUTHZ / CAP-UI-ADMIN；foundation/m06 | §4.1、§4.2、§6.1、§6.2、§7.4、§8.3 | SCN-05 | 待走查 | — |

---

## 3. NFR 覆盖

| NFR | 设计落点 | 覆盖场景 | 状态 |
|-----|----------|----------|------|
| NFR-01~02（中心不采集 / 取消 management 域） | HLD §3、§5.1、§6.4 | SCN-01 | **已收敛**（实现仅创建 `edge`，通道固定 `agent_pull`；migration 0013 拒绝 `management`，0014 移除本表运行态字段） |
| NFR-03（租户与网域隔离） | HLD §6.3、§9 | SCN-02 | 部分（M09 查询注入已有；跨租户验收待补） |
| NFR-04（管理最小授权门） | HLD §6.2 | SCN-02/05 | 已实现 |
| NFR-05（生产管理员密码） | HLD §9 | SCN-05 | 待部署环境验证 |
| NFR-06（敏感信息保护） | HLD §9 | SCN-01/05 | 已实现（Token 脱敏、哈希不入响应） |
| NFR-07（编码不可变） | HLD §5.3、§6.4 | SCN-01/02 | 已实现 |
| NFR-08（软删与审计） | HLD §5.2、§8 | SCN-03/05 | 已实现 |
| NFR-09（幂等初始化） | HLD §12 | 全部 | 已实现（migration upsert） |
| NFR-10（列表性能） | HLD §10 | 全部 | 部分（压测待补） |
| NFR-11~12（业务语言 / 错误可执行） | HLD §6、§14 B | 全部 | 设计覆盖，全站文案检查待补 |

---

## 4. 新增能力论证

本轮无新建能力；SCN-01~05 均复用现有 `m06` / `foundation` / `m09` / `m07` 能力。

后续如出现“必须新建能力”的需求，需在本表补充：

| CAP | 为什么不能复用/扩展现有能力 | 抽象/扩展点 | 变体点 | 决策 |
|-----|----------------------------|-------------|--------|------|

---

## 5. 未决问题 / 反馈

| # | 问题 | 场景 | Owner | 状态 |
|---|------|------|-------|------|
| 1 | **网域类型口径冲突**：SRS v1.3 主张取消 `management` / `default` / `local`，当前实现仍保留（管理域系统预置、通道按域类型派生），M09 文档也按管理域描述 | SCN-01/03 | 需求 Owner + 技术 Owner | **closed（2026-11-23）**：按 SRS 收敛实现——移除模型中的管理域类型/默认域常量/`ChannelForDomainType`/local 通道；migration 归一历史数据并收紧 CHECK；M09 注释与前端文案同步移除管理域口径 |
| 2 | 场景演示脚本与实测结果尚未建立，SCN-01~05 未走查 | 全部 | 技术 Owner | open |
| 3 | FR-12 审计日志、FR-13 平台配置为 P2 / v1.0+，未纳入本轮验收 | 全部 | 需求 Owner | open |
| 4 | SRS 称 MVP 仅开放 `platform_admin` 查看/编辑、不开放创建租户，但实现已提供租户创建/状态变更接口，范围口径待统一 | SCN-02 | 需求 Owner | open |
| 5 | NFR-05「生产未配置管理员密码则启动失败」需在部署环境实测确认 | SCN-05 | 技术 Owner | open |

---

## 6. 双方确认

- 需求 Owner：待确认
- 技术 Owner：待指定
- 文档状态：draft

## 7. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-11-22 | 创建 M06 场景链接矩阵；SCN-01~05；能力图例；NFR 覆盖；登记网域类型口径冲突 |
| 2026-11-23 | 关闭网域类型口径冲突：NFR-01~02 改为已收敛；同步 SRS v1.5 / HLD v1.1；记录代码、迁移与前端文案收敛范围 |
