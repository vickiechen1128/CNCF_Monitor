# 跨域 central 规则 jobref 校验输入集 — 设计提案

> 状态：merged（2026-09-23，真实环境验证通过，track B 收尾）
> 关联模块：M09 配置中心（配置文件下发，0.2 多域增量）
> 关联反馈：`docs/05-execution-records/module-11/dev-feedback.md` F-14
> 路线：Track B（轻量增量，验证通过后回写 M09 PRD）

---

## 1. 需求背景

M09 配置文件下发在 MVP 单域（default，local 通道）下已闭环。0.2 引入多域（边缘域 agent_pull 通道）后，`scope=central` 的全局告警规则由**中心求值器**（`centerEvaluator := dom.Channel == local`）对**所有网域 remote_write 上来的数据**求值，中心 TSDB 含全部网域 job（如边缘域 `tengxunyun-ceshi-host`）。

但 M09 发布期 jobref 门禁（决策 66）的生效 Job 集合仍用 `scrapeConfigJobNames(ca.PrometheusYML)` —— 即**当前变更单所在网域**的 prometheus.yml `scrape_configs[].job_name`。当 default 域规则引用边缘域 job 时，边缘 job 不在 default 域产物中，被误判「job 不存在」→ 存活类（expr 含 `up`）判 error → 阻断发布。

**死结**：规则挂 default 域被误判阻断；挂边缘域则 `centerEvaluator=false` 不生成 rule_files，中心不加载规则 → 告警不生效。跨域 central 规则当前**无合法发布路径**。

**根因**：中心求值器的「全局语义」与 jobref 校验的「按域集合语义」未协调。M01 侧已实现 scope 感知的统一输入集 `effectiveJobNames(db, scope, domainID)`（决策 67-4 预留，central = 全库 job 并集），但 M09 发布期校验未接入，仍保留旧的第二输入集 `scrapeConfigJobNames`。

## 2. 场景判定：采集节点离线自治告警与 scope 演化

> 多轮讨论结论，作为「为何本轮不做边缘求值、为何 scope 停在 central」的决策依据。

### 2.1 两个概念澄清

- **离线自治告警**：核心是「求值自治」——边缘本地放规则求值器（vmalert），即便与中心断网，也能对本地采集数据求值、判定告警；「分派自治」是下游，断网时的通知送达还依赖本地可达接收端或断网缓存补发。当前边缘仅有 vmagent（抓取+转发、不执行 rules）+ blackbox_exporter，**无规则求值器**。
- **数据合规不出域**：指某些域的**原始指标样本**因合规约束不允许 remote_write 上传中心 TSDB；当前「边缘全量上报中心」默认违反该约束（前提是该域有此约束）。本项目为普通运维指标（up/CPU/拨测），**无合规敏感，不触发**。

### 2.2 edge scope 触发判定

`edge`/`both` scope（v0.4+ 预留）= 边缘本地求值，需边缘补求值器（vmalert）+ 本地 Alertmanager，是架构级演进。触发条件：

| 触发条件 | 本项目现状 | 是否触发 |
|---|---|---|
| 边缘域与中心网络频繁中断、中断期须持续告警 | 隧道偶断，可接受中心告警短暂缺失 | 否 |
| 数据受合规约束、原始指标不得出域 | 运维指标无合规敏感 | 否 |
| 边缘告警量大、需本地收敛降中心压力 | 告警量小、无此压力 | 否（optional） |

### 2.3 结论

本项目场景**未命中 edge scope 任一硬触发条件**，应停在 `central` 单一 scope：规则中心求值、挂 default 域下发、本轮清掉边缘 rules.yml 死文件。仅需在契约留「未来反转」注记——v0.4 落地边缘求值器后，边缘 rules.yml 会从死文件复活为活配置，届时契约反向（边缘重新接收规则）。

## 3. 设计范围

本轮包含两个互补改动，共同收敛「central 规则中心求值」的闭环：

| 改动 | 内容 | 效果 |
|---|---|---|
| **Y（主线，方案 A）** | M09 发布期 jobref 输入集从「本域产物」切换为「central 全域并集」 | default 域校验规则引用边缘域 job 不再误判 |
| **X（附带，F-14 决策问题 3）** | `Assemble` 对非 centerEvaluator 域不再注入 rules | 清掉边缘 rules.yml 死文件；规则变更不再触发边缘域变更单 |

**不改动**（本轮边界外）：
- M01 编辑期 jobref 校验（已正确使用 `effectiveJobNames`，无缺陷）。
- `jobref` 包本身（纯解析判定，无 gorm 依赖，保持不变）。
- 边缘求值器（vmalert）/ 边缘本地 Alertmanager（v0.4+ edge scope 才建设）。

**未来反转预留**：改动 X 清掉边缘 RulesYML，需在代码注释标注「v0.4 边缘求值器落地时反向恢复」。

## 4. 详细设计

### 4.1 现状（问题链路）

```
generator.ValidateArtifacts(ca, includeBlackbox)          // generator 包，无 db 参数
  └─ if ca.RulesYML != "":
       jobref.Validate(ca.RulesYML, scrapeConfigJobNames(ca.PrometheusYML))  // ① 本域产物 job 集合
          scrapeConfigJobNames: 解析 ca.PrometheusYML 顶层的 scrape_configs[].job_name
```

M01 侧已有正确实现：

```
platform/strategy/rule/validate.go
  effectiveJobNames(db, scope, domainID):                 // 私有
    scope == central → 全库 enabled+draft_status=ready 的 job_name（全域并集）
    scope == edge/both → 按 network_domain_id 过滤
  ValidateRuleJobRefsForScope(db, content, scope, domainID):  // 公开，封装 effectiveJobNames + jobref.Validate
```

即「单一实现（jobref.Validate）+ 同一输入集（effectiveJobNames）」的目标已在 M01 落地，M09 侧 `scrapeConfigJobNames` 是漏网的「第二输入集」。

### 4.2 改动 Y：jobref 输入集收敛（推荐路径 B）

保持 `generator` 包无 gorm 依赖（纯产物校验），由调用侧（draft 包）计算 central 全域 job 名单并传入。

```
1. rule 包导出名单函数（薄封装，保持不变语义）:
   func EffectiveJobNames(db *gorm.DB, scope models.ScopeType, domainID string) []string {
       return effectiveJobNames(db, scope, domainID)
   }

2. generator.ValidateArtifacts 增加参数 platformJobs []string:
   func ValidateArtifacts(ca *ConfigArtifacts, includeBlackbox bool, platformJobs []string) (...)

   内部 L165 改为:
     issues := jobref.Validate(ca.RulesYML, platformJobs)

3. draft/service.go 三处调用点传入:
   platformJobs := rule.EffectiveJobNames(db, models.ScopeTypeCentral, "")
   generator.ValidateArtifacts(artifacts, artifacts.BlackboxYML != "", platformJobs)
   调用点: L102 / L302 / L850（三处所在函数均有 *gorm.DB 可用，已核实）

4. 删除 scrapeConfigJobNames（含 generator_test.go:577-582 的 3 处测试），
   generator_test.go 中 8 处 ValidateArtifacts 调用补传 job 名单参数。

5. import: draft 包 import "platform/strategy/rule"；generator 包 import 不变
   （仍只用 platform/strategy/rule/jobref，不引 rule 父包，避免 gorm 进入 generator）。
```

备选（路径 A，不推荐）：`generator.ValidateArtifacts` 直接加 `db *gorm.DB` 参数，内部调 `rule.ValidateRuleJobRefsForScope(db, ca.RulesYML, models.ScopeTypeCentral, "")`。缺点：generator 引入 gorm 依赖，generator_test 全部要造内存 DB，改动面大。

### 4.3 改动 X：边缘域不再注入 rules

`buildArtifacts(db, dom)`（[draft/service.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/draft/service.go#L176-L225)）已计算 `centerEvaluator := dom.Channel == local`。在其调用 `generator.Assemble(dom.ID, ..., rules, ..., centerEvaluator)` 前（或 Assemble 内部入口）对非 centerEvaluator 域置空规则集：

```
if !centerEvaluator {
    rules = nil // 决策：central 规则只进中心求值器，边缘域不携带 rules.yml（死文件）
}
```

> 实现时确认优劣：调用侧置空（改动集中在 draft 包）vs `Assemble` 内部入口置空（generator 包内特判）。倾向调用侧，保持 generator 的 `centerEvaluator` 参数语义（控制 rule_files/alerting 注入）不变、新增「rules 为空时自然无 RulesYML/rule_files」。
>
> 未来反转：此处需注释标注「v0.4 edge scope 落地（边缘引入 vmalert）时反向恢复，让边缘域重新接收 rules」。

### 4.4 关键判定口径

- M09 发布期规则为 `scope=central` 全集（无网域列），故 `platformJobs` **恒为 central 全域并集**（`ScopeTypeCentral` + 空 domainID），**与草稿所在网域无关**。
- central 全域并集 = `WHERE enabled = true AND draft_status = 'ready'` 的 `job_name`，覆盖 local + edge 所有已部署 job。
- 场景未触发 edge scope（§2），故**无需**为 edge/both 预留按域分支；v0.4 前 `EffectiveJobNames` 恒以 central 调用。
- 存活类 error 判定保持：引用「全域都不存在」的 job 仍 error 阻断；引用「任一域已部署」的 job 通过。

### 4.5 影响面与风险

| 项 | 说明 |
|---|---|
| 行为变化 Y | central 规则跨域引用从「error 阻断」→「通过」，语义与中心求值器全局求值自洽 |
| 行为变化 X | 规则变更不再触发边缘域变更单；边缘产物无 rules.yml（死文件清除） |
| 纯 local 路径 | 全库并集在单域下 = 原单域集合，**不改变现有行为**（`effectiveJobNames` 注释已声明）；改动 X 对 local 域（centerEvaluator=true）无影响 |
| 循环依赖 | `strategy/rule` 不依赖 generator/configcenter/draft，draft→rule 无循环；generator 保持只依赖 `rule/jobref` |
| 测试 | generator_test 补传名单参数；draft 相关测试补「边缘域产物无 rules.yml」断言 |

## 5. 验收标准

1. `go test ./platform/...` 全绿；`go vet ./platform/...` 无告警。
2. 单测覆盖：
   - central 规则引用**边缘域**已部署 job → 发布期校验 passed（不再 error）；
   - central 规则引用**全局不存在的** job（存活类 expr 含 up）→ 仍 error 阻断；
   - 非存活类引用不存在 job → 仍 warning 提示；
   - `EffectiveJobNames(central, "")` 返回全库 job 并集；
   - 改动 X：`Assemble(edge 域)` 产物 `RulesYML==""` 且无 `rule_files`；`Assemble(default)` 保留 rules + rule_files。
3. 服务启动 + 真实环境验证：在 default 域草稿挂载 `expr: up{job="tengxunyun-ceshi-host"} == 0` 的 central 规则，校验通过、可确认发布；边缘域变更单不再出现 rules 相关变更项。
4. `scrapeConfigJobNames` 已删除，无残留调用。

## 6. 与现有 PRD 差异点

M09 PRD（MVP 单域）隐含「jobref 校验基于本域产物」「规则随逐域草稿下发」。0.2 多域落地后需在 PRD 第 6 章接口契约 / 第 9 章验收标准补充：

- **规则 job 引用校验口径**：`scope=central` 规则的生效 Job 集合 = 全平台已部署（enabled + ready）job 并集（跨 local/edge 域）；跨域引用合法。
- **规则变更单网域归属**：central 规则**固定挂管理域（default，local 中心求值器）发布**；边缘域配置包不再携带 rules.yml。
- **scope 语义与场景**：`central` 为当前唯一 scope（中心全局求值）；`edge`/`both` 为 v0.4+ 预留（边缘本地求值），触发条件为「边缘离线自治告警」或「数据合规不出域」，本项目场景均未触发。

## 7. 合并计划

1. 按 track B：本提案经 Orchestrator/PM 评审 → 状态 `approved`。
2. 开发侧 `feat/module-09-config-center` 按 §4.2（Y）+ §4.3（X）实现 + TDD + 单测 + 本机验证 + commit（带 task id）。
3. 用户本地 + 腾讯云跨域联调验证通过后，回写 M09 PRD（§6 差异点）+ PRD 版本 +1 + Change Log，本提案状态改 `merged`。

## 8. 待决策问题（实现前）

- [ ] 确认改动 Y 采用路径 B（调用侧传名单）优于路径 A（generator 引 db）。
- [ ] 确认改动 X 置空位置：调用侧 `buildArtifacts` vs `Assemble` 内部入口（§4.3 已给倾向）。
- [x] 已确认：central 规则固定挂 default 域发布（§6 第 2 条）。
- [x] 已确认：边缘域 rules.yml 本轮清掉（改动 X，含未来反转预留）。