// Package query — M01 资源身份只读回连解析器（M08 v1.15 决策 70）。
//
// 背景：告警列表的「实例」列展示的是 Prometheus `instance` 标签——即 file_sd 抓取地址
// `generator.instanceAddress(ip, exporterPort)`，形如 `ip:9100`（exporter 端口）。
// 它既不是用户在资源清单里看到的实例名，端口也不是用户填写的业务端口。
// `resource_id`（决策 47-3 强制注入为 system 层标签、模板不可覆盖）是二者之间的钥匙：
// 本文件按 resource_id 一次性批量回连 M01 五类资源表，给出归一化身份视图，供
//
//   - M02 GET /api/v1/alerts（Prometheus 当前触发告警代理）
//   - M02 GET /api/v1/alerts/history（历史告警代理）
//   - M08 GET /api/v2/platform/alertmanager/alerts（Alertmanager 通知状态代理）
//
// 三条链路回填 `resource_name` 等实例字段。
//
// 只读约束：本文件只做 SELECT，不写 M01 任何表；每类资源表一次 `IN` 查询（共 5 条
// SQL），禁止逐 resource_id 查询（TQ-6 反 N+1，与 coverage 同口径）。
//
// 容错口径：单类资源表查询失败**只跳过该类**（其余类别照常回填），错误经
// `errors.Join` 汇总返回；调用方使用 `ResolveResourceIdentitiesSafe` 时永不阻塞告警主链路。
//
// 契约：docs/05-execution-records/module-08/api-contract-snapshot.md §10.1/§10.2。
package query

import (
	"errors"
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// ResourceIdentity 是 M01 资源清单在告警展示层的归一化身份视图（M08 v1.15 决策 70）。
type ResourceIdentity struct {
	// ResourceID 是 M01 资源 UUID（= 告警标签 resource_id）。
	ResourceID string
	// Name 是资源清单口径的实例名：host=InstanceName、database/middleware=InstanceIP、
	// application=ServiceName、generic_target=TargetName（对齐 M07 §5.12 展示口径）。
	Name string
	// Category 是五类资源枚举（models.ResourceCategory 字符串值）。
	Category string
	// IP 是资源 IP（host=private_ip；database/middleware/generic_target=instance_ip；
	// application 无独立 IP 字段，取空）。
	IP string
	// Port 是资源业务端口；0 表示该类别无业务端口（如 host）。
	// 注意与「采集地址」中的 exporter 端口区分。
	Port int
}

// InstanceFields 是三条告警读取链路共用的实例展示字段组（JSON 平铺进各响应项）。
// 字段语义见契约快照 §10.1；新增字段不删旧字段，向后兼容。
type InstanceFields struct {
	// InstanceAddress 是「采集地址」：Prometheus 抓取地址（instance → instance_ip →
	// nodename → device 回落），聚合 / 全局告警为空串（前端展示「全局/聚合」）。
	InstanceAddress string `json:"instance_address"`
	// InstanceDisplay 是兼容字段：resource_name 非空取之，否则取标签回落链
	// （instance_name → instance → instance_ip → service_name → nodename → device）。
	InstanceDisplay string `json:"instance_display"`
	// ResourceID 是告警标签 resource_id（无则为空串）。
	ResourceID string `json:"resource_id"`
	// ResourceName 是回连 M01 得到的实例名；无 resource_id 或未命中时为空串
	// （前端「实例名」列显示 `-`，**不回落成地址**）。
	ResourceName string `json:"resource_name"`
	// ResourceCategory 是五类资源枚举；未命中时为空串。
	ResourceCategory string `json:"resource_category"`
	// ResourceIP 是资源 IP；未命中时为空串。
	ResourceIP string `json:"resource_ip"`
	// ResourcePort 是资源业务端口；未命中 / 无业务端口时为 0。
	ResourcePort int `json:"resource_port"`
}

// instanceAddressKeys 是「采集地址」的标签回落键序（纯地址语义，不含名称类标签）。
var instanceAddressKeys = []string{"instance", "instance_ip", "nodename", "device"}

// instanceDisplayKeys 是「实例展示值」的标签回落键序（M08 v1.15 决策 70 修订）：
// 删除死键 `hostname`（默认标签模板从不产出，见 module-01 dev-feedback F-38），
// 补入 application 实际产出的 `service_name`，并预留三期新增的 `instance_name`。
var instanceDisplayKeys = []string{"instance_name", "instance", "instance_ip", "service_name", "nodename", "device"}

// InstanceFieldsOf 组装单条告警的实例展示字段组。
//
// identities 为回连结果（可为 nil / 空 map）。标签无 `resource_id` 或未命中时
// ResourceName 为空串、InstanceDisplay 走标签回落链（对应拨测 / 聚合 / 自写规则
// 三类无 resource_id 的情形）；InstanceAddress 恒为「采集地址」语义。
func InstanceFieldsOf(labels map[string]string, identities map[string]ResourceIdentity) InstanceFields {
	f := InstanceFields{
		InstanceAddress: firstLabelOf(labels, instanceAddressKeys),
		ResourceID:      labels["resource_id"],
	}
	if ident, ok := identities[f.ResourceID]; ok {
		f.ResourceName = ident.Name
		f.ResourceCategory = ident.Category
		f.ResourceIP = ident.IP
		f.ResourcePort = ident.Port
	}
	// 兼容字段：可读名优先（回连结果），其次走标签回落链。
	f.InstanceDisplay = f.ResourceName
	if f.InstanceDisplay == "" {
		f.InstanceDisplay = firstLabelOf(labels, instanceDisplayKeys)
	}
	return f
}

// firstLabelOf 返回 labels 中按 keys 顺序首个非空值；全空返回空串。
func firstLabelOf(labels map[string]string, keys []string) string {
	for _, k := range keys {
		if v := labels[k]; v != "" {
			return v
		}
	}
	return ""
}

// ResolveResourceIdentities 按 resource_id 批量回连 M01 五类资源表（只读）。
//
//   - 入参 ids 允许重复与空串，内部去重；空输入或 db 为 nil 时直接返回空 map；
//   - 返回 map[resource_id]ResourceIdentity，未命中的 id 不出现在结果中；
//   - 单类资源表查询失败只跳过该类（其余类别照常回填），错误经 errors.Join 汇总返回；
//     调用方应继续使用已回填的部分结果（见 ResolveResourceIdentitiesSafe）；
//   - 每类资源表一次 `IN` 查询（共 5 条 SQL），与调用方传入的 id 数量无关。
func ResolveResourceIdentities(db *gorm.DB, ids []string) (map[string]ResourceIdentity, error) {
	out := make(map[string]ResourceIdentity)
	if db == nil || len(ids) == 0 {
		return out, nil
	}
	uniq := make([]string, 0, len(ids))
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		uniq = append(uniq, id)
	}
	if len(uniq) == 0 {
		return out, nil
	}

	var errs []error

	var hosts []models.Host
	if err := db.Where("resource_id IN ?", uniq).Find(&hosts).Error; err != nil {
		errs = append(errs, fmt.Errorf("resolve host identities: %w", err))
	} else {
		for i := range hosts {
			h := &hosts[i]
			id := h.GetResourceID()
			out[id] = ResourceIdentity{
				ResourceID: id,
				Name:       h.InstanceName,
				Category:   string(models.ResourceCategoryHost),
				IP:         h.PrivateIP,
			}
		}
	}

	var databases []models.Database
	if err := db.Where("resource_id IN ?", uniq).Find(&databases).Error; err != nil {
		errs = append(errs, fmt.Errorf("resolve database identities: %w", err))
	} else {
		for i := range databases {
			d := &databases[i]
			out[d.ResourceID] = ResourceIdentity{
				ResourceID: d.ResourceID,
				Name:       d.InstanceIP, // 模型无 instance_name 列，按 M07 §5.12 展示口径取 IP
				Category:   string(models.ResourceCategoryDatabase),
				IP:         d.InstanceIP,
				Port:       d.Port,
			}
		}
	}

	var middlewares []models.Middleware
	if err := db.Where("resource_id IN ?", uniq).Find(&middlewares).Error; err != nil {
		errs = append(errs, fmt.Errorf("resolve middleware identities: %w", err))
	} else {
		for i := range middlewares {
			m := &middlewares[i]
			out[m.ResourceID] = ResourceIdentity{
				ResourceID: m.ResourceID,
				Name:       m.InstanceIP, // 同上：无 instance_name 列
				Category:   string(models.ResourceCategoryMiddleware),
				IP:         m.InstanceIP,
				Port:       m.Port,
			}
		}
	}

	var applications []models.Application
	if err := db.Where("resource_id IN ?", uniq).Find(&applications).Error; err != nil {
		errs = append(errs, fmt.Errorf("resolve application identities: %w", err))
	} else {
		for i := range applications {
			a := &applications[i]
			out[a.ResourceID] = ResourceIdentity{
				ResourceID: a.ResourceID,
				Name:       a.ServiceName,
				Category:   string(models.ResourceCategoryApplication),
				Port:       a.Port,
			}
		}
	}

	var generics []models.GenericTarget
	if err := db.Where("resource_id IN ?", uniq).Find(&generics).Error; err != nil {
		errs = append(errs, fmt.Errorf("resolve generic_target identities: %w", err))
	} else {
		for i := range generics {
			g := &generics[i]
			out[g.ResourceID] = ResourceIdentity{
				ResourceID: g.ResourceID,
				Name:       g.TargetName,
				Category:   string(models.ResourceCategoryGenericTarget),
				IP:         g.InstanceIP,
				Port:       g.Port,
			}
		}
	}

	return out, errors.Join(errs...)
}

// ResolveResourceIdentitiesSafe 是 ResolveResourceIdentities 的降级封装：
// 忽略错误并返回**已回填的部分结果**（单类表缺失不影响其它类别），保证只读增强
// 永不阻塞告警主链路。三条告警读取链路统一走本函数。
func ResolveResourceIdentitiesSafe(db *gorm.DB, ids []string) map[string]ResourceIdentity {
	identities, _ := ResolveResourceIdentities(db, ids)
	if identities == nil {
		return map[string]ResourceIdentity{}
	}
	return identities
}
