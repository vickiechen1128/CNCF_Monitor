# 产品需求文档目录

> 本目录存放 MetricCenter 的产品需求文档（PRD）。  
> 为避免文档重复和理解偏差，各文档有明确职责边界。开发前应优先阅读本页。

---

## 文档职责一览

| 文档 | 职责 | 谁应该看 | 不重复写什么 |
|------|------|----------|--------------|
| [00_Product_Vision.md](00_Product_Vision.md) | 产品定位、核心价值、目标用户、边界、成功指标 | 所有人 | 不写具体技术架构、不写详细功能清单、不写开发顺序 |
| [00_Global_Architecture.md](00_Global_Architecture.md) | 系统总体架构、控制面/数据面分层、数据流、技术栈 | 架构师、后端开发、AI 开发 | 不写详细功能点、不写具体字段模型 |
| [01_User_Stories.md](01_User_Stories.md) | 用户故事、使用场景 | 产品经理、开发 | 不写实现方案 |
| [02_Product_Roadmap.md](02_Product_Roadmap.md) | 里程碑、开发顺序、各阶段交付物 | 项目经理、开发负责人 | 不写详细功能设计、不写实施难度矩阵 |
| [03_Functional_Architecture.md](03_Functional_Architecture.md) | 全量功能架构：模块 → 一级功能 → 二级功能 | 产品经理、开发 | 不写 Prometheus 复用度、不写落地难度 |
| [04_Implementation_Map.md](04_Implementation_Map.md) | 实施难度地图：Prometheus 复用度、前后端工作量、落地优先级 | 技术负责人、开发 | 不写功能详细定义、不写完整数据模型 |
| [Modules/*.md](Modules/) | 各模块详细需求：数据模型、接口、验收标准 | 对应模块开发 | 不写整体架构、不写演进路线 |

---

## 关键决策归属

遇到以下问题时，应优先查看对应文档：

| 问题 | 查看文档 |
|------|----------|
| 这个产品要解决什么问题？目标用户是谁？ | [00_Product_Vision.md](00_Product_Vision.md) |
| 控制面和数据面如何划分？技术栈是什么？ | [00_Global_Architecture.md](00_Global_Architecture.md) |
| MVP 要做到什么？未来分几阶段？ | [02_Product_Roadmap.md](02_Product_Roadmap.md) |
| 有哪些模块和功能？ | [03_Functional_Architecture.md](03_Functional_Architecture.md) |
| 这个功能落地难不难？是否需要自研后端？ | [04_Implementation_Map.md](04_Implementation_Map.md) |
| 这个模块的字段、接口、验收标准是什么？ | [Modules/对应模块.md](Modules/) |

---

## 防止重复的约定

1. **00_Product_Vision.md 只写"为什么"和"是什么"**：不写架构图、不写功能清单细节、不写技术演进表格。
2. **00_Global_Architecture.md 只写"整体怎么搭"**：不写具体字段、不写每个功能的二级菜单。
3. **02_Product_Roadmap.md 只写"什么时候做"和"做到什么程度"**：不写实施难度矩阵（在 04_Implementation_Map 中）。
4. **03_Functional_Architecture.md 只写"有什么功能"**：不写 Prometheus 复用度评估。
5. **04_Implementation_Map.md 只写"落地难度和优先级"**：不写功能完整定义。
6. **Modules/*.md 只写"这个模块怎么做"**：不写整体架构、不写演进路线。

---

## 阅读顺序

### 首次了解项目

1. [00_Product_Vision.md](00_Product_Vision.md) — 理解产品定位
2. [00_Global_Architecture.md](00_Global_Architecture.md) — 理解技术架构
3. [02_Product_Roadmap.md](02_Product_Roadmap.md) — 理解阶段规划

### 准备开发某个模块

1. [03_Functional_Architecture.md](03_Functional_Architecture.md) — 找到对应模块的功能范围
2. [04_Implementation_Map.md](04_Implementation_Map.md) — 评估落地难度和优先级
3. [Modules/对应模块.md](Modules/) — 查看详细需求、数据模型、验收标准

---

## MVP 关键结论速查

- **资源管理**：三类固定资源（Host / Middleware / Application），Excel 导入，字段固定，必须归属网域（MVP 默认 `default`）
- **网域模型**：MVP 预置默认网域 `default`，数据模型已为多网域物理隔离场景预留扩展
- **告警规则**：MVP 不写 UI，直接编辑 `rules.yml`
- **告警收敛/静默/通知**：MVP 借助 Alertmanager 原生能力
- **拨测**：使用 Blackbox Exporter，MetricCenter 只生成配置
- **时序存储**：MVP 用 Prometheus TSDB；多网域场景演进为 VictoriaMetrics / Mimir
- **平台元数据**：MVP 用 SQLite
- **代码隔离**：所有业务代码在 `platform/` 和 `ui-custom/`，不修改 `upstream/`
