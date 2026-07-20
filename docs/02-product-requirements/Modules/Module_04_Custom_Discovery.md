# Module 04: 自定义服务发现

> **模块类型**: 扩展能力模块  
> **依赖文档**: [00_Global_Architecture.md](../00_Global_Architecture.md)、[03_Functional_Architecture.md](../03_Functional_Architecture.md)、[Module_07_Config_Management.md](Module_07_Config_Management.md)  
> **目标用户**: 运维工程师、运维架构师  
> **版本**: v2.0  
> **更新日期**: 2026-07-20

---

## 1. 模块目标

让 MetricCenter 能够对接企业外部的 CMDB、Nacos、HTTP 注册中心等，自动发现采集目标。

> **MVP 阶段**：本模块不做。资源通过 [Module 07: 配置管理](Module_07_Config_Management.md) 的 Excel 导入功能维护。  
> **v0.4 阶段**：引入自定义服务发现，优先支持腾讯蓝鲸 CMDB 和通用 HTTP 接口。

---

## 2. 用户故事

- OPS-02：从外部 CMDB 批量同步采集目标
- ARCH-03：查看平台整体采集覆盖率

---

## 3. 核心功能

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 外部 CMDB 发现 | 从腾讯蓝鲸等 CMDB 拉取应用系统与实例列表 | P2 |
| Nacos 发现 | 从 Nacos 注册中心发现服务实例 | P2 |
| HTTP 发现 | 从自定义 HTTP 接口获取目标列表 | P2 |
| 目标转换 | 将外部数据格式转换为 MetricCenter Resource 模型 | P2 |
| 同步策略 | 全量同步、增量同步、定时同步 | P2 |

---

## 4. 接口抽象

本模块的 Provider 接口与 [Module 07](Module_07_Config_Management.md) 中定义的 `CMDBProvider` 对齐：

```go
// platform/discovery/provider/provider.go
type Provider interface {
    Name() string
    ListResources(ctx context.Context, resourceType ResourceType, filter Filter) ([]Resource, error)
}
```

MVP 阶段由 Module 07 实现：
- `ExcelProvider`：Excel 导入
- `SQLiteProvider`：本地 SQLite 存储

未来由本模块扩展：
- `BlueKingProvider`：腾讯蓝鲸 CMDB
- `HTTPProvider`：通用 HTTP CMDB
- `NacosProvider`：Nacos 注册中心
- `KubernetesProvider`：K8s Endpoints/Service

---

## 5. 依赖

- `upstream/prometheus/discovery/discovery.go`
- `upstream/prometheus/discovery/targetgroup/`
- `platform/discovery/`
- `platform/config/cmdb_provider.go`

---

## 6. 验收标准

- [ ] 实现至少一种外部 Provider（腾讯蓝鲸 或 HTTP）
- [ ] Provider 输出能被转换为 MetricCenter Resource 模型
- [ ] 新增/删除目标能自动同步到资源管理模块
- [ ] 同步后的目标可通过配置管理模块生成 prometheus.yml
