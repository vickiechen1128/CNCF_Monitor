# CNCF_Monitor / MetricCenter 项目上下文

本项目是基于 Prometheus 改造包装的企业级指标采集与查询中心。

## 项目定位

- **统一指标采集**：管理多源、多协议、多环境的指标采集目标
- **统一查询入口**：门户化指标查询与可视化
- **可扩展底座**：支持自定义服务发现、采集逻辑、前端展示与数据转发

MVP 版本聚焦：**配置管理 + 手动 CMDB + Prometheus 配置下发**。

## 技术栈

- **后端引擎**：Prometheus（Go）
- **扩展层**：Go 1.25+
- **Gateway**：Go + Gin（暂定）
- **前端**：React 18 + TypeScript + Vite
- **数据库（平台数据）**：SQLite（开发期）/ PostgreSQL（生产期）
- **部署**：Docker / Docker Compose

## 目录结构

```
CNCF_Monitor/
├── .trae/skills/                    # Trae 原生 Skill（源码架构探索入口）
├── .kimi/                           # Kimi Agent 团队配置
├── upstream/                        # 上游开源源码
│   ├── prometheus/
│   └── node_exporter/
├── platform/                        # MetricCenter 业务扩展代码
├── ui-custom/web/                   # 独立前端门户
├── patches/prometheus/              # 对上游源码的必要 patch
├── scripts/                         # 构建脚本
├── deploy/                          # 部署配置
├── docs/                            # 文档
│   ├── 04-source-architecture/      # 源码架构理解
│   ├── 02-product-requirements/     # 产品需求文档
│   └── 03-engineering-standards/    # 工程约束与标准
├── Makefile
└── README.md
```

## 常用命令

```bash
# 安装工具链（Go + Node.js + pnpm）
make install-tools

# 编译后端
make build-prometheus

# 启动 Prometheus
make run-prometheus

# 编译前端
make build-ui

# 启动前端开发服务器
make dev-ui

# 运行 platform 测试
go test ./platform/...

# 应用 upstream patch
make apply-patches
```

## 核心原则

1. **不直接修改 `upstream/` 源码**，业务代码放在 `platform/`
2. 必须修改 upstream 时，生成 patch 到 `patches/prometheus/`
3. 开发前阅读相关 PRD 和工程标准
4. 代码变更同步更新文档
5. `.trae/skills/` 和 `.kimi/` 目录不得删除

## Trae Skill 与 .kimi Skill 的协作

> **当前状态**：未购买 Kimi CLI Agent，所有入口统一在 **Trae IDE 对话面板**。`.kimi/` 目录完整保留，未来开通 Kimi CLI 会员后可直接启用。

- **`.trae/skills/codebase-architecture-explorer`**：当前在 Trae IDE 中询问源码架构、模块职责、二次开发难度时的主要入口，驱动只读分析。
- **`.kimi/skills/`**：项目规范化知识库。当前在 Trae 中可通过引用对应 `SKILL.md` 注入上下文；未来 Kimi CLI Agent 开发前会默认加载 `cncf-project`，必要时加载 `prometheus-architecture`、`golang-coding-style` 等。
- **`.kimi/agents/*.md`**：Agent 提示词资产。当前在 Trae 中需要扮演特定角色时，可直接引用对应 markdown 作为上下文。
- 架构分析结论应及时同步到 `.kimi/skills/prometheus-architecture/SKILL.md`，保持两套体系知识一致。
- 详细对应关系参见 [`.kimi/AGENTS.md`](../AGENTS.md)。

## 关键文档

- [产品愿景](../../docs/02-product-requirements/00_Product_Vision.md)
- [全局架构](../../docs/02-product-requirements/00_Global_Architecture.md)
- [MVP 核心：监控对象管理模块](../../docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md)
- [代码隔离标准](../../docs/03-engineering-standards/01_Code_Isolation_Standard.md)
- [API 设计标准](../../docs/03-engineering-standards/03_API_Standard.md)
- [Agent 协作速查](../AGENTS.md)
