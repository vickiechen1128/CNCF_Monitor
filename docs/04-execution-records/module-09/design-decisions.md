# 设计决策记录：module-09

## 会议/对齐信息

- 日期：2026-08-02
- 参与 Agent：prototype-designer、orchestrator
- 触发原因：基于现有 PRD 生成可点击原型并验证设计理解

## 关键决策

### 决策 1：原型风格与呈现方式

- 问题：原型采用何种视觉风格以便领导/业务方快速理解产品形态？
- 结论：采用火山引擎 Volcengine 设计 Token（主色 #0ECDEB、头部 #0B1B2A）作为原型风格，保持企业级云产品观感。
- 依据：用户需求 / 火山引擎品牌色参考
- 影响范围：docs/prototypes/module-09/ 全部页面

### 决策 2：模块原型独立拆分

- 问题：全模块统一原型还是按模块独立原型？
- 结论：按 prototype-designer 规范，每个模块产出独立的 Vite + React 原型项目，便于后续按模块评审、冻结与开发。
- 依据：`.kimi/agents/prototype-designer.md` 目录规则
- 影响范围：docs/prototypes/module-01/ ~ module-10/

### 决策 3：当前 PRD 范围确认

- 问题：当前 PRD 是否足以支撑原型验证？
- 结论：PRD v1.0 已覆盖本模块核心数据模型、页面与 MVP 边界，原型按 PRD 实现，未发现 [待验证] 技术缺口。
- 依据：docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md
- 影响范围：原型页面范围

## 待确认项

- [ ] 领导评审后对页面信息架构的反馈
- [ ] 是否需要针对 MVP 范围进一步裁剪页面字段

## 关联文档

- `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`
- `docs/prototypes/module-09/`

---

## 决策：网域模式与配置下发中心行为（2026-08-03）

### 背景

用户提出新需求：

- **单一网域用户**：在配置下发中心不应按网域划分管理，也不需要查看监控代理节点状态。
- **多网域用户**：需先配置不同网域，再接入各网域下的监控代理节点；完成后才能在资源管理、监控策略进行配置，并将配置下发到对应监控代理节点。

### 决策记录

| # | 决策 | 依据 | 影响范围 |
|---|------|------|----------|
| 1 | 网域生命周期与 Agent 管理归属 **Module_09** | `NetworkDomain` 数据模型唯一 Owner 为 Module_09；配置生成/预览/下发/Agent 接入均由本模块负责 | Module_09 PRD、数据模型、API |
| 2 | 单网域/多网域通过 `feature_flags.multi_site_enabled` 切换 | [02_Product_Roadmap.md](../../02-product-requirements/02_Product_Roadmap.md) 已定义该开关；避免对单机用户造成认知负担 | 前端菜单、后端权限、UI 渲染 |
| 3 | 单网域模式隐藏「网域管理」与「Agent 状态」入口 | 单网域场景无物理隔离 Edge Agent，网域与 Agent 状态页对用户无意义 | Module_09 前端页面、门户菜单 |
| 4 | 数据模型始终保留 `default` 网域 | 保证单网域与多网域切换时资源归属不中断，所有资源必须有 `network_domain_id` | `NetworkDomain` 模型、`Resource.network_domain_id` |
| 5 | 从单网域切换到多网域时，现有资源自动归属 `default` | `default` 作为初始网域，用户可后续迁移或保留作为中心直接采集域 | 迁移逻辑、后端初始化 |
| 6 | 配置下发中心在单网域模式下只面向中心 Prometheus | 不展示网域选择器、不展示多网域分发；确认后仅触发中心 `/-/reload` | 配置下发 UI、`ConfigDeployment.target_type` |
| 7 | 多网域模式下，配置下发中心按网域展示草稿/diff/下发记录 | 每个网域独立 `ConfigDraft` / `ConfigVersion` / `ConfigDeployment` | 配置下发 UI、配置包拉取 |
| 8 | 单网域模式下 Edge Sync Agent 协议接口不面向用户暴露 | **后端保留协议能力，仅 UI 隐藏**；便于单网域向多网域平滑扩展 | Edge Sync Agent API、鉴权、UI |

### 待确认项（已确认）

| 问题 | 决策 | 落地位置 |
|------|------|----------|
| `multi_site_enabled` 是平台级还是租户级开关？ | **租户级开关**，体现在 `Tenant.multi_site_enabled`；与“1 租户 : N 网域”上层设计关联更合理 | Module_06 `Tenant` 模型、Module_09 3.11 节 |
| 单网域模式下 Edge Sync Agent 协议如何处理？ | **后端保留协议能力，仅 UI 隐藏**；便于用户从单网域扩展到多网域时无需重新部署 Agent，符合产品交付“全套多网域、按需使用”的定位 | Module_09 3.11 节 |
| `default` 网域是否可编辑/删除？ | **允许修改 `name` / `description`** 以匹配用户云区域命名；**类型定义为 `management`（管理域），禁止删除** | Module_09 4.1 节 `domain_type` 字段 |
| Module_07 在单网域模式下是否隐藏「网域」列？ | **不隐藏**；网域即云区域，是从 CMDB/Excel 代入的必要字段 | Module_07 3.1、5.4 节 |

### 关联文档

- `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`
- `docs/02-product-requirements/Modules/Module_06_Multi_Tenant.md`
- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`

---

## 决策：配置生成文件映射、targets 模式与 Edge Agent 能力边界（2026-08-05）

### 背景

用户基于 Module_09 原型（v1.2）评审提出 5 个设计讨论点，经 Orchestrator 派发技术预研（Prometheus / VictoriaMetrics 官方文档）与两轮讨论后确认以下决策。

### 决策记录

| # | 决策 | 依据 | 影响范围 |
|---|------|------|----------|
| 1 | 标签模板（`LabelTemplate`）变更触发 **targets 列表 labels 变化**，而非 `prometheus.yml` 结构变化 | 资源标签（CMDB/user/system 来源）在生成 targets 时静态展开到 target labels；`prometheus.yml` 仅含网域级 `global.external_labels`（network_domain/tenant_id，由 NetworkDomain 驱动） | 配置文件映射、3.3 节、配置生成 |
| 2 | **MVP 范围 = 单网域 + 前端自动化下发**：配置生成 → UI 确认 → 自动写文件并 reload 中心 Prometheus；无 Edge Agent 协议暴露（后端保留、UI 隐藏） | 与 3.11 节单网域模式一致；MVP 聚焦中心自动化，隔离域能力延后 | MVP 边界、下发流程 |
| 3 | targets 采用 **file_sd（JSON 文件）**，暂不考虑 http_sd | 政务/金融专网断网风险：file_sd 的 targets 文件落本地磁盘，断网进程存活可继续抓取、**断网重启后本地立即恢复**；http_sd 依赖中心 API 在线、重启后 targets 丢失，不满足弱网自治要求 | 配置包结构、下发链路、3.3 / 6.2 节 |
| 4 | **MVP 即实施 file_sd**（难度中等偏低，增量约 15-20%）。关键设计点：targets 用固定文件名 `targets/<job>.json` + 原子写；**联合 checksum 需纳入 targets 内容**；生成器侧做 JSON schema 校验（`promtool check config` 对 file_sd 内容不校验）；reload 策略分离（仅结构变化才 reload，targets 变化由磁盘监听自动感知） | 最高频变化对象是 targets，file_sd 让 targets 变更免 reload、避免采集抖动；官方定位即"外部系统驱动 targets 的桥接机制" | 数据模型（ConfigDraft/ConfigVersion 承载 targets）、联合 checksum 算法、配置生成 |
| 5 | **Edge Agent 能力分层**：L1（配置同步 + vmagent 控制 + 心跳回执）为 v0.2 核心；**L2（为下游节点安装 exporter）因安全边界暂不纳入 PRD** | L2 扩大 agent 信任半径，涉及凭据管理、供应链、合规审计，需单独立项评审（详见下方风险备注） | Edge Agent 协议、模块边界、PRD 范围 |

### L2 能力风险备注（暂不纳入 PRD 的文字说明）

边缘 Agent 的 L2 能力（为网域内下游节点安装/升级 exporter）涉及安全边界扩展，暂不纳入 PRD 范围。风险点如下：

1. **凭据暴露面扩大**：Agent 需持有下游节点的 SSH/Agent 凭据才能安装 exporter。一旦 Agent 所在主机被攻破，网域内全部监控节点的凭据随之暴露，攻击面从"单个采集节点"放大为"整个网域"。
2. **供应链风险**：Agent 需向网域内节点分发并安装 exporter 二进制，若分发链路缺乏校验/签名，被篡改的恶意二进制将被批量植入所有节点。
3. **敏感配置注入**：部分 exporter 需注入账号密码等敏感配置（如 MySQL/Redis），传输与落盘环节的加密与密钥管理要求随之提高。
4. **合规与审计缺口**：自动化安装减少人工介入，必须提供完整的安装/升级/卸载审计与回执，否则难以满足政务/金融专网的变更审计要求。
5. **与现有流程冲突**：当前 `ExporterInstallationConfirmation` 采用人工确认制；自动化安装将改变该流程（转为"安装回执驱动"），需重新评审后再变更。

**结论**：L2 技术可行但信任半径过大。建议单独立项，先定义凭据管理、分发校验（checksum/签名）、回执模型与审计方案，再考虑进入 PRD。

### 补充决策（2026-08-05 第二轮原型评审）

用户基于原型 v1.4 评审提出配置包形态、targets 扩展性、rules.yml scope 语义、Edge Sync Agent 部署定位等问题，补充确认以下决策：

| # | 决策 | 依据 | 影响范围 |
|---|------|------|----------|
| 6 | **配置产物形态按域类型分层**：中心管理域（default）为**本地文件集**（prometheus.yml + targets/*.json + rules.yml + blackbox.yml），直接写中心 Prometheus 配置目录，确认后 SIGHUP / `-/reload`，无 zip、无 metadata.json 下载校验（版本一致性由 ConfigVersion 记录保证）；**边缘域**为 **zip 配置包**（含 metadata.json 供拉取后 checksum 校验），Agent 心跳拉取。分层依据是域类型（management/edge），而非单/多网域开关 | 单网域模式无 Agent/无拉取，zip 与 metadata.json 仅对边缘拉取有意义 | Module_09 3.11 / 6.2、原型 renderPackageTree |
| 7 | **targets 前端数据驱动、扩展性确认**：`targets/<job_name>.json` 由 configgen 自动按 job 名生成；前端预览的 targets 子 Tab 动态遍历 `targets_files` 数据渲染，**新增 job 无需改前端**（三层解耦：文件命名=后端、展示=数据驱动、用户入口=Module_01/07 策略配置） | 原型 v1.4 已用 `Object.keys(targets_files)` 动态生成子 Tab 验证 | Module_09 3.4 / 4.4、前端展示 |
| 8 | **rules.yml scope 业务场景澄清**：MVP~v0.3 阶段 `scope` 固定 `central`（中心统一求值），用户无需配置 scope；`edge`/`both` 为 v0.4+（P2，由 Module_08 支持）预留，核心场景为**断网自治告警**（边缘 vmalert 本地求值 + 本地通知通道），`both` 用于边缘快速响应 + 中心聚合（需标签区分求值域去重），`central` 用于跨域/全局聚合规则 | Module_01 5.5 scope 定义（MVP~v0.3 固定 central） | Module_01 5.5、Module_09 3.3 |
| 9 | **Edge Sync Agent 部署定位澄清**：Edge Sync Agent 是**部署在边缘监控代理节点的独立客户端程序**，非中心平台内置进程；与中心通过 **outbound HTTPS 443 + 每网域 Token** 通信（心跳 / 配置拉取 / remote_write 全部边缘主动出站，中心无入站端口）；MVP 单网域不部署，v0.2+ 多网域每个边缘节点部署一个 | PRD 3.9 交付方式（离线二进制包 + systemd）与 6.x 协议 | Module_09 3.9、网域注册安装指引 |

### 补充决策（2026-08-05 第三轮评审：中心/边缘校验分层与衔接）

用户提问"配置生成功能的前端展示与 Edge Sync Agent 能力的关系"，确认以下设计：

| # | 决策 | 依据 | 影响范围 |
|---|------|------|----------|
| 10 | **中心/边缘校验分层与衔接**：前端「配置生成/预览」对标的是**中心侧控制**（生成 + 内容校验 + 人工确认），Edge Sync Agent 对标的是**边缘侧消费**（拉取 + 传输校验 + 应用 + 回执），两者由**同一份配置产物（ConfigVersion / zip 包）**衔接，不是"对标 Agent 能力"也不是"另一套独立校验"。校验分两层：**中心①内容校验**（promtool / blackbox --config.check / targets schema，结果以 `validation_status` 在前端展示）防**生成错误**，**边缘②传输校验**（metadata.json checksum 完整性 + targets JSON 解析，PRD 6.3）防**传输损坏/篡改/半写**。设计要点：① Agent 为「哑校验」——不做 promtool 级语法校验（中心已保证产物合法，校验①失败会阻止确认下发）；② 联合 checksum 双用途——中心草稿去重裁决 + 边缘拉包完整性校验；③ `config_sync_status`（in_sync / out_of_sync / manual_override）为 Agent 应用回执，与中心 `validation_status` 构成闭环两端 | 同产物两段链路（中心控制 / 边缘消费）；校验防不同风险；Agent 哑校验降低边缘实现复杂度 | Module_09 6.3 / 5.2 / 3.5.1、校验语义 |

### 关联文档

- `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`
- `docs/prototypes/module-09/`
- 技术预研依据：
  - Prometheus file_sd：https://prometheus.io/docs/prometheus/latest/configuration/configuration/#file_sd_config
  - Prometheus file-sd 官方指南：https://prometheus.io/docs/guides/file-sd/
  - Prometheus http_sd：https://prometheus.io/docs/prometheus/latest/http_sd/
  - VictoriaMetrics Service Discovery：https://docs.victoriametrics.com/sd_configs/
