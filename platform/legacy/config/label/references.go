// 本文件提供标签模板的「引用方」只读查询能力，供删除前的引用保护
// （DELETE /api/v2/platform/label-templates/:template_id，Module_07 §6.6.3.1）
// 与引用清单聚合接口（GET /api/v2/platform/label-templates/:template_id/references）
// 共用。
//
// 数据所有权与实现口径：
//   - ScrapeJob / CITypeExporterMapping 两张表的**数据所有权归 Module_01**，
//     M07 仅**只读消费**用于删除前校验，**不新增任何写路径**、不修改这两张表的
//     任何数据（Module_07 §6.5 / §6.6.3.1）；
//   - 本文件是 M07 侧读取这两张表的**唯一收敛点**：对外暴露
//     TemplateReferenceSource 接口，日后若要收敛架构（例如改走 M01 只读 HTTP
//     接口或抽公共 repository 层），只需替换实现，不触碰 handler 与测试。
//
// 判定口径（Module_07 §6.6.3.1，与 M01 侧只读反查接口保持一字不差）：
//   - **停用引用同样计入**：ScrapeJob.enabled=false 的 Job 仍构成引用，不按
//     enabled 过滤。理由是停用 Job 可随时原地复用，其 target 配置仍留在已下发的
//     prometheus.yml 中未回收，删模板会让「恢复启用」在无感知的情况下换掉标签集；
//   - **软删不计入**：deleted_at 非空的行视为已废弃，不构成引用。两模型均 embed
//     models.BaseModel（resource.go 的 DeletedAt gorm.DeletedAt），**由 GORM 软删
//     自动过滤，此处刻意不手写 deleted_at IS NULL**（与 M01 侧反查同口径）；
//   - **不按 is_default / is_builtin 过滤**：CI 侧的内置与每类型默认映射同样是有效
//     引用方，过滤掉会让「模板无人引用」的结论失真。
package label

import (
	"fmt"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// 引用来源标识（refs[].source，Module_07 §6.6.3.1）：区分引用方来自哪张表，
// 便于前端定位要解绑哪些对象。
const (
	// RefSourceScrapeJob 采集 Job 引用方（models.ScrapeJob）。
	RefSourceScrapeJob = "scrape_job"
	// RefSourceCIMapping CI 类型映射引用方（models.CITypeExporterMapping）。
	RefSourceCIMapping = "ci_mapping"
)

// TemplateReference 是单个引用方的统一视图（Module_07 §6.6.3 接口表）：
// `{ source, id, name, network_domain_id?, monitor_type?, enabled? }`。
//
// 字段按来源可选填充：采集 Job 有 name / network_domain_id / enabled，CI 类型映射
// 有 name（monitor_type）/ monitor_type，无 enabled 语义。
type TemplateReference struct {
	Source          string `json:"source"`                      // scrape_job / ci_mapping
	ID              uint   `json:"id"`                          // 引用方主键
	Name            string `json:"name"`                        // 展示名（Job=job_name；CI 映射=monitor_type）
	NetworkDomainID string `json:"network_domain_id,omitempty"` // 仅 scrape_job
	MonitorType     string `json:"monitor_type,omitempty"`      // 仅 ci_mapping
	Enabled         *bool  `json:"enabled,omitempty"`           // 仅 scrape_job（停用仍计入引用）
}

// TemplateReferenceSource 是引用清单的只读数据源（窄接口隔离层）。
//
// 之所以抽象成接口而非直接在 handler 里查表：本文件是 M07 读取 M01 拥有的两张表的
// 唯一收敛点，接口化后架构演进只需替换实现。返回的引用项已按 §6.6.3.1 口径过滤
// （软删自动排除、停用计入），实现方无需重复判定。
type TemplateReferenceSource interface {
	// ListReferences 返回引用 labelTemplateID 的全部引用方清单；无引用返回空切片
	// 而非 nil，且不报错（无引用是正常业务结果，非异常）。
	ListReferences(labelTemplateID uint) ([]TemplateReference, error)
}

// TemplateReferenceSourceFunc 把普通函数适配为 TemplateReferenceSource，便于在
// 测试中注入故障（验证「数据源不可用时保守拒绝」）而不必造真实的库表故障。
type TemplateReferenceSourceFunc func(labelTemplateID uint) ([]TemplateReference, error)

// ListReferences 实现 TemplateReferenceSource。
func (f TemplateReferenceSourceFunc) ListReferences(labelTemplateID uint) ([]TemplateReference, error) {
	return f(labelTemplateID)
}

// gormTemplateReferenceSource 是基于 *gorm.DB 的 TemplateReferenceSource 实现。
//
// M07 与 M01 在同一进程、共享同一个 *gorm.DB handle（cmd/metric-center/main.go 中
// label.RegisterRoutes 与 strategy.RegisterRoutes 传入同一 db.DB），因此这里直接
// 同库只读查询两张表即可，无需经由 HTTP 回环调用本进程自身的接口。
type gormTemplateReferenceSource struct {
	db *gorm.DB
}

// NewTemplateReferenceSource 构造基于 *gorm.DB 的引用清单数据源（生产装配入口）。
func NewTemplateReferenceSource(db *gorm.DB) TemplateReferenceSource {
	return &gormTemplateReferenceSource{db: db}
}

// ListReferences 聚合两张表的引用清单：先采集 Job，再 CI 类型映射，两侧合并返回。
//
// 任一侧查询失败即整体返回错误，**不返回部分结果**——删除路径据此保守拒绝（见
// DeleteLabelTemplate），宁可拦住一次合法删除，也不冒静默漂移风险。
func (s *gormTemplateReferenceSource) ListReferences(labelTemplateID uint) ([]TemplateReference, error) {
	// label_template_id 在两模型中均为 string 语义，模板 ID 以十进制字符串存储
	// （与 M01 侧反查 GET /scrape-jobs?label_template_id= 的比对口径一致）。
	id := strconv.FormatUint(uint64(labelTemplateID), 10)

	// 采集 Job 侧：不过滤 enabled（停用引用同样禁删），软删由 GORM 自动过滤。
	var jobs []models.ScrapeJob
	if err := s.db.Where("label_template_id = ?", id).
		Order("created_at desc").Find(&jobs).Error; err != nil {
		return nil, fmt.Errorf("查询引用模板 %d 的采集 Job: %w", labelTemplateID, err)
	}

	// CI 类型映射侧：不过滤 is_default / is_builtin（内置与默认映射也是有效引用方）。
	var mappings []models.CITypeExporterMapping
	if err := s.db.Where("label_template_id = ?", id).
		Order("created_at desc").Find(&mappings).Error; err != nil {
		return nil, fmt.Errorf("查询引用模板 %d 的 CI 类型映射: %w", labelTemplateID, err)
	}

	refs := make([]TemplateReference, 0, len(jobs)+len(mappings))
	for _, j := range jobs {
		enabled := j.Enabled // 停用（false）同样计入引用，此处如实回传给前端
		refs = append(refs, TemplateReference{
			Source:          RefSourceScrapeJob,
			ID:              j.ID,
			Name:            j.JobName,
			NetworkDomainID: j.NetworkDomainID,
			Enabled:         &enabled,
		})
	}
	for _, m := range mappings {
		refs = append(refs, TemplateReference{
			Source:      RefSourceCIMapping,
			ID:          m.ID,
			Name:        m.MonitorType,
			MonitorType: m.MonitorType,
		})
	}
	return refs, nil
}

// ListTemplateReferences 是 GET /api/v2/platform/label-templates/:template_id/references
// 的 handler：聚合引用该模板的采集 Job 与 CI 类型映射清单（Module_07 §6.6.3.1）。
// 响应 data：`{refs: [{source, id, name, network_domain_id?, monitor_type?, enabled?}],
// total: N}`；无引用返回空 refs 与 total=0。
//
// 模板不存在 / 已软删返回 not_found。数据源查询失败返回 internal_server_error
// （保守报错，不伪装成「无引用」）。
func ListTemplateReferences(db *gorm.DB, src TemplateReferenceSource) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseTemplateID(c)
		if !ok {
			response.BadRequest(c, fmt.Errorf("template_id 非法"))
			return
		}

		var tmpl models.LabelTemplate
		if err := db.First(&tmpl, id).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				response.NotFound(c, fmt.Sprintf("label template %d not found", id))
				return
			}
			response.InternalServerError(c, fmt.Errorf("get label template %d: %w", id, err))
			return
		}

		refs, err := src.ListReferences(id)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, gin.H{"refs": refs, "total": len(refs)})
	}
}
