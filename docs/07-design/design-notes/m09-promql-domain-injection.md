# 设计专题：PromQL 网域注入

> 所属模块：M09 配置与查询中心
> 对应 SRS：FR-18 ~ FR-20、NFR-08
> 关联代码：`platform/modules/m09/service/promql.go`、`query_service.go`、`handler/query_handler.go`
> 状态：已实现（护栏待补）

---

## 1. 为什么需要注入

中心 Prometheus 存储多个网域的数据，但平台用户只应看到被授权网域。隔离必须在服务端完成：

- 浏览器不直连 Prometheus：直连会绕过用户鉴权与网域隔离；
- PromQL 由用户输入，不能要求用户自己写 `network_domain_id` 过滤；
- 任何用户（含平台管理员）不能 bypass。

因此查询代理在转发前，对表达式中的每个时间序列选择器追加 `network_domain_id` 约束。

---

## 2. 授权网域解析

`AllowedDomains(ctx, actor)` 从 M06 的租户/用户授权关系解析当前用户可见网域集：

- 返回空集时，使用 `network_domain_id=~""`（匹配空，不泄露数据）；
- 返回集合时，构造 `network_domain_id=~"d1|d2"`；
- 不注入 `tenant`：数据面 `external_labels` 只有 `network_domain_id`，注入 tenant 会导致全量查询匹配空（D28/D33）。

API 参数/响应仍使用 `network_domain`（历史字段名），注入使用数据面真实标签 `network_domain_id`。

---

## 3. 注入规则

### 3.1 查询表达式

`/api/v1/query`、`/api/v1/query_range` 对 `query` 参数执行 `InjectDomain(expr, matcher)`。

### 3.2 标签/序列枚举

`/api/v1/labels`、`/api/v1/series`、`/api/v1/label/:name/values` 对每个 `match[]` 执行 `InjectMatcher`：

```text
无 match[]        -> 追加 "{network_domain_id=~\"...\"}"
match[]={...}     -> 在花括号内追加 "，matcher"
match[]=up        -> InjectDomain("up", matcher) -> up{network_domain_id=~"..."}
```

### 3.3 告警

`/api/v1/alerts` 转发后按告警 labels 中的 `network_domain_id` 过滤；未带该标签的告警不可见（fail-closed）。

> 注意：`ALERTS{...}` 序列是否携带 `network_domain_id` 取决于告警规则标签；若不带，注入后会查空。告警时间窗叠加建议优先使用平台告警事件表。

---

## 4. 算法（字符串级扫描）

实现刻意保守，不引入完整 PromQL 解析器；目标是“不破坏合法表达式，并覆盖所有 selector”。

```text
遍历字符：
  跳过字符串字面量（"..."、'...'、`...`）
  跳过范围 [5m]、label list（by/without/on/ignoring/group_left/group_right）
  遇到 selector：
    - 裸指标名（标识符 + 可选 {labels}） -> 在 { 内追加 matcher，或补 {matcher}
    - 顶层 {...}（无指标名）            -> 在 { 内追加 matcher
  其他 token（函数、运算符、数字、持续时间）原样复制
无 selector 的表达式（如 1+2）原样返回
```

示例：

```text
up                                        -> up{network_domain_id=~"default|gov-a"}
up{job="node"}                            -> up{job="node",network_domain_id=~"default|gov-a"}
sum by(job)(rate(node_cpu_seconds_total{mode="idle"}[5m]))
                                          -> sum by(job)(rate(node_cpu_seconds_total{mode="idle",network_domain_id=~"..."}[5m]))
{__name__="up"}                           -> {__name__="up",network_domain_id=~"..."}
1+2                                       -> 1+2
```

---

## 5. 已知边界与风险

| 项 | 说明 | 处理 |
|----|------|------|
| 复杂表达式 | 子查询、`offset`、`@`、特殊函数 | 预置表达式加回归用例；注入失败应由 Prometheus 返回 `bad_data`，不静默改语义 |
| 字符串中的花括号 | 已跳过字符串字面量 | 单测覆盖 |
| label list | `by/without/on/ignoring/group_*` 不注入 | 单测覆盖 |
| `ALERTS` | 可能不带网域标签 | 告警叠加改用平台事件表；不依赖注入后的 ALERTS |
| 注入不校验 PromQL | 非法表达式由 Prometheus 报错 | 前端展示 `bad_data` 原文 |
| 无授权 | `=~""` 匹配空 | 返回空结果，不报错 |

---

## 6. 错误与上限

- 上游 5xx / 不可达 → 502 `bad_gateway`；
- 上游 4xx 原样透传（保留 `bad_data` 等 errorType）；
- 响应体上限 8 MiB（`io.LimitReader`）；
- 待补：`query_range` 的 range/step/timeout/查询长度护栏（概要设计 §10.1）。

---

## 7. 测试矩阵

| 输入 | 期望 |
|------|------|
| `up` | 追加 matcher |
| `up{job="x"}` | 花括号内追加，保留原标签 |
| 字符串 `"a{b}"` | 不改写字符串内容 |
| `[5m]` | 不改写范围 |
| `by (job)` | 不注入 label list |
| 无 selector `1+2` | 原样返回 |
| 空授权 | `=~""` |
| 多网域 | `=~"d1|d2"`，特殊字符转义 |
| `/labels` 无 match[] | 追加 match[] 子句 |
| `/series` 多个 match[] | 每个都注入 |
| 告警无网域标签 | 不出现在结果中 |
