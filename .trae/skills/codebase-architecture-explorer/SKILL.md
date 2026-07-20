---
name: "codebase-architecture-explorer"
description: "分析开源项目源码架构、核心模块与数据流，评估二次开发难度。Invoke when user wants to understand a codebase's overall design, entry points, module responsibilities, extension points, or effort required for customization."
---

# Codebase Architecture Explorer

用于系统性分析开源项目（尤其是 CNCF 监控类项目，如 Prometheus、node_exporter）的源码架构，帮助快速理解整体设计、定位核心模块、识别扩展点，并评估二次开发的可行性与难度。

## 使用场景

在以下情况调用本 Skill：

- 用户想要理解一个新接触的代码库的整体架构
- 用户计划基于现有项目进行二次开发或定制
- 用户需要评估某个功能改动的实现难度和影响范围
- 用户需要向未接触过该产品的领导/同事介绍技术实现
- 用户需要为 AI 开发工程师编写知识地图或协作文档

## 分析流程

分析源码时，按以下步骤由宏观到微观逐步深入。每一步结束后应做一个小结，再进入下一步。

### 1. 项目概览与定位

- 阅读项目根目录的 `README.md`、`go.mod`、`Makefile`、`VERSION` 等文件
- 明确项目的主要目标、版本、编程语言、构建方式
- 记录官方文档入口、架构图或设计文档链接
- 识别项目类型：服务端程序 / 命令行工具 / 库 / Exporter / Agent

### 2. 目录结构分析

- 使用 `tree` 或分层列出主要目录
- 将每个顶层目录映射到功能职责
- 重点关注：
  - `cmd/` - 程序入口
  - `pkg/` / `internal/` - 内部包
  - `api/` / `proto/` - 接口定义
  - `config/` - 配置解析
  - `docs/` - 文档
  - `vendor/` 或依赖管理文件

### 3. 程序入口与启动流程

- 定位 `main.go` 或对应入口文件
- 跟踪启动顺序：参数解析 → 配置加载 → 组件初始化 → 服务启动
- 画出启动流程中的关键对象生命周期
- 识别守护进程、HTTP/gRPC 服务、工作协程的启动点

### 4. 核心模块识别

针对监控类项目，重点识别：

- **数据采集层**：Target 发现、Scrape 调度、指标解析
- **存储层**：TSDB、索引、压缩、 retention
- **查询层**：PromQL 解析、执行、API
- **告警层**：规则评估、通知发送
- **服务发现层**：Kubernetes、Consul、文件等发现机制
- **Exporter 层**：collector 注册、指标采集、平台适配

对每个核心模块，记录：

- 主要职责
- 关键文件与类型
- 对外接口
- 内部状态机（如有）

### 5. 数据流与调用链

- 选择一个典型场景（如：一次指标抓取、一条告警触发、一次查询请求）
- 从入口到出口跟踪完整调用链
- 标注跨模块边界、序列化点、持久化点
- 识别同步 / 异步、阻塞 / 非阻塞、批处理 / 流式处理

### 6. 关键接口与扩展点

- 查找接口（`interface`）、钩子（hook）、插件（plugin）机制
- 记录用户可扩展的位置：
  - 自定义 collector（Exporter）
  - 自定义服务发现（SD）
  - 自定义存储后端（Remote Storage）
  - 自定义告警接收器
- 评估扩展所需的代码侵入程度和接口稳定性

### 7. 依赖与外部集成

- 阅读 `go.mod`，列出关键外部依赖及其用途
- 识别与 Kubernetes、etcd、Consul、云厂商 API 的集成点
- 评估外部依赖的成熟度、许可证、社区活跃度

### 8. 二次开发难度评估

从以下维度给出评估：

| 维度 | 评估内容 | 难度等级 |
|------|----------|----------|
| 代码规模 | 代码行数、模块数量、测试覆盖率 | 低 / 中 / 高 |
| 技术栈熟悉度 | Go、Protobuf、PromQL、TSDB、Kubernetes 等 | 低 / 中 / 高 |
| 模块耦合度 | 核心模块是否解耦，接口是否清晰 | 低 / 中 / 高 |
| 扩展机制 | 是否提供插件/接口/钩子 | 低 / 中 / 高 |
| 测试与调试 | 单元测试、集成测试、本地运行难度 | 低 / 中 / 高 |
| 文档完整度 | 设计文档、开发指南、API 文档 | 低 / 中 / 高 |
| 社区活跃度 | Issue/PR 响应、版本发布周期 | 低 / 中 / 高 |

最终给出：

- 整体二次开发难度评级
- 推荐的切入点（最小可行改动）
- 高风险区域（需要谨慎改动的代码）
- 建议的学习路径

## 输出模板

最终输出建议使用以下结构：

```markdown
# <项目名称> 架构分析报告

## 1. 项目概览
- 项目名：
- 版本：
- 语言/构建工具：
- 项目定位：

## 2. 目录结构与模块职责
| 目录 | 职责 |
|------|------|
| ... | ... |

## 3. 启动流程
1. ...
2. ...

## 4. 核心模块
### 4.1 <模块名>
- 职责：
- 关键文件：
- 接口：

## 5. 典型数据流
### 场景：<场景名>
```
<调用链描述或 Mermaid 序列图>
```

## 6. 扩展点与接口
- <扩展点1>：...
- <扩展点2>：...

## 7. 二次开发难度评估
| 维度 | 等级 | 说明 |
|------|------|------|
| ... | ... | ... |

## 8. 建议
- 切入点：
- 风险点：
- 学习路径：
```

## Go 项目分析特别提示

分析 Prometheus、node_exporter 等 Go 项目时，额外注意：

- `interface` 定义通常揭示核心抽象
- `prometheus/client_golang` 是指标暴露的基础
- `collector.Collector` 是 node_exporter 扩展的核心接口
- `discovery.Discoverer` 是 Prometheus 服务发现的核心接口
- `storage` 包定义了远程读写的抽象
- 大量使用 `context.Context` 控制生命周期
- 测试文件（`*_test.go`）是理解接口用法的最佳入口

## 示例用户请求

- "帮我理解一下 Prometheus 的整体架构"
- "node_exporter 如果要加一个新的 collector，应该从哪入手？"
- "评估一下在 Prometheus 里增加一个自定义服务发现模块的难度"
- "把 Prometheus 的 scrape 流程给我讲清楚"

## 与 .kimi 的协作说明

> **当前状态**：未购买 Kimi CLI Agent，所有入口统一在 **Trae IDE 对话面板**。`.kimi/` 目录完整保留，未来开通 Kimi CLI 会员后可直接启用。

- **Trae Skill（本文件）**：当前在 Trae IDE 中进行源码架构只读探索与分析的主要入口，输出架构报告。
- **.kimi Skill**：项目规范化知识库。当前可在 Trae 对话中引用 `.kimi/skills/` 下的 SKILL.md 作为上下文；未来 Kimi CLI Agent 团队会直接加载这些 Skill。
- **.kimi/agents/*.md**：Agent 提示词资产。当前在 Trae 中需要让模型扮演 planner / developer / reviewer 等角色时，可直接引用对应 markdown。

当使用本 Skill 完成架构分析后，应及时将关键结论同步到：

- `.kimi/skills/prometheus-architecture/SKILL.md`：Prometheus 架构、扩展点、关键接口
- `.kimi/skills/cncf-project/SKILL.md`：项目整体上下文、目录结构、核心原则

协同关系详见 `.kimi/AGENTS.md`。
