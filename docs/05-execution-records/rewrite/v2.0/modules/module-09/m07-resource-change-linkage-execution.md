# M07 资源变更即时联动（方案 1）执行记录

- 状态：implemented / verified（定向测试 + 服务实测）
- 日期：2026-11-18
- 关联：M09 SRS v1.8 FR-10 / §8.3；M07 SRS v2.2 §8.1~§8.6 / NFR-17

## 1. 需求口径

- **已有 Job 的已选资源**：资源的 IP / 端口 / 标签修改、资源删除、标签模板变更、Excel 导入、批量改归属/端口后，best-effort 触发 M01 对账 + M09 配置重算；30s watcher / 60s 对账兜底。
- **新增资源不会自动加入已有 Job**：Job 保存的是 `selected_instance_ids` 静态列表；“某个云全量机器”只是保存时的选例快照。
- **动态 filter 选例不在本期范围**：按云/条件自动纳入新资源需要新增 `instance_selection_mode=filter`，属独立功能。

## 2. SRS 回填

- M09 SRS 增加 v1.8 Change Log，FR-10 / §3.4 / §8.3 补充即时联动、静态选例边界；
- M07 SRS 增加 v2.2 Change Log，§8.1 / §8.2 / §8.3 / §8.4 / §8.6 / NFR-17 补充保存后 best-effort 通知 M01/M09、watcher 兜底、静态选例边界。

## 3. 代码实现

### 3.1 M07 变更通知端口

新增 `platform/modules/m07/references/change_notifier.go`：

```go
type ResourceChangeNotifier interface {
    ResourceChanged(ctx context.Context, domainIDs ...string)
    AllResourcesChanged(ctx context.Context)
}
```

默认 `NoopChangeNotifier`，未接线时不影响现有测试 / 独立运行。

接入服务：

- `ResourceService`：Create / Update / Delete / BulkReassign / BulkSetScrapePort；
  - 单资源写入通知所属网域（更新时同时通知旧/新网域）；
  - 批量操作通知全部网域。
- `ImportService`：导入成功且有新增/更新时通知全部网域。
- `LabelService`：资源用户标签增删改后通知所属网域。
- `LabelTemplateService`：模板创建/更新/删除后通知全部网域。

### 3.2 组合根异步联动

`platform/cmd/metric-center/v3.go` 新增 `m07ChangeNotifier`：

1. 异步（30s 超时）先执行 `m01Module.ReconcileNow`，清理已删除/移域的 `selected_instance_ids`；
2. 再调用 `m09Module.NotifyConfigSync(domainIDs)` 或 `NotifyAllConfigSync()`；
3. 失败只记日志，不阻断 M07 保存。

M09 `ConfigTriggerService` 新增内部通知入口：

- `NotifyDomains`
- `NotifyAllDomains`

复用现有 500ms debounce 队列，避免批量操作触发 N 次 promtool。

### 3.3 防跨域目标残留

`GORMSourceReader.BuildSource` 增加资源域校验：

```go
if !ok || ref.NetworkDomainID != domainID { continue }
```

即使 M01 对账还没跑，已删除或已移到其他网域的资源也不会进入旧域 targets。

### 3.4 M01 对账并发保护

`ReconcileService.ReconcileOnce` 增加 mutex，避免 60s 后台对账与 M07 即时通知对账并发更新 Job。

## 4. 验证

定向测试：

```bash
go test ./platform/modules/m07/... ./platform/modules/m09/... ./platform/modules/m01/... -count=1
go test ./platform/cmd/metric-center -count=1
go vet ./platform/modules/m01/... ./platform/modules/m07/... ./platform/modules/m09/... ./platform/cmd/metric-center
```

新增用例：

- `TestResourceWritesNotifyConfigSync`：资源创建/删除通知所属网域，批量改端口通知全部网域；
- `TestLabelTemplateWritesNotifyAllDomains`：模板创建/更新/删除均通知；
- `TestImportNotifiesAllDomains`：导入成功通知；
- `TestConfigTriggerNotifyDomainsEnqueues` / `TestConfigTriggerNotifyAllDomainsEnqueues`：M09 内部通知入口；
- `TestSourceReaderExcludesResourceMovedToAnotherDomain`：移域资源不泄漏进旧域 targets。

服务实测：

- 8080 已用新二进制重启，health 200；
- 通过 API 创建临时主机资源（mc-614daa56）后删除，M07 保存正常，日志无 `m07→m01` / `m09 config trigger` 错误；
- 临时资源未被任何 Job 选中，配置快照数量保持 4 条，符合“新增资源不自动加入已有 Job”的边界。

## 5. 待收尾 / 不在本期

1. 动态 filter 选例（按云/条件全量机器自动跟随）未实现，需要独立设计；
2. 批量/导入通知全部网域，域数量很多时可进一步按受影响 domain 收敛；
3. 按用户要求未跑全量前后端测试。
