// 本文件提供 LabelTemplate 的创建 / 更新 / 删除接口
// （POST/PUT/DELETE /api/v2/platform/label-templates[/:template_id]）与修改快照
// （LabelTemplateSnapshot）写入，见 Module_07 §3.2 / §6.3 / §6.6.3。
package label

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// snapshotOperator 是模板修改快照的操作人。MVP 无鉴权（决策 8），固定
// platform_admin（Module_07 §3.2 / §5.3）。
const snapshotOperator = models.PlatformAdminTenantID

// CreateLabelTemplateRequest 是创建模板的请求体。
//
//   - name / resource_category 必填；
//   - description 可选：LabelTemplate 模型当前无 Description 列（本任务冻结
//     platform/models/），解析后暂不落库，见 CreateLabelTemplate 内 TODO；
//   - mappings 可选：传入时走 validateMappings 基础校验（T07-16 增强完整规则）。
type CreateLabelTemplateRequest struct {
	Name             string                 `json:"name"`
	ResourceCategory models.ResourceCategory `json:"resource_category"`
	Description      *string                `json:"description"`
	Mappings         []models.LabelMapping  `json:"mappings"`
}

// UpdateLabelTemplateRequest 是更新模板的请求体：仅可改 name / description，
// resource_category 创建后不可改（传入不同值返回 bad_request，PRD §6.6.3）。
type UpdateLabelTemplateRequest struct {
	Name             *string                  `json:"name"`
	Description      *string                  `json:"description"`
	ResourceCategory *models.ResourceCategory `json:"resource_category"`
}

// validResourceCategory 报告 cat 是否为五大类权威枚举之一（Module_07 §5.1）。
func validResourceCategory(cat models.ResourceCategory) bool {
	for _, v := range models.ValidResourceCategories() {
		if v == cat {
			return true
		}
	}
	return false
}

// validateMappings 是模板 mappings 校验：每条映射的 target_label 非空且合法
// （含保护 label 拦截——composite→instance 例外）、composite 目标标签锁定
// instance、source_type/source_field/transform 枚举、同模板 target_label 唯一
// （§5.11 / §9.2）。供 CreateLabelTemplate 与 mappings.go 复用。
func validateMappings(mappings []models.LabelMapping) error {
	seen := make(map[string]struct{}, len(mappings))
	for i, m := range mappings {
		if strings.TrimSpace(m.TargetLabel) == "" {
			return fmt.Errorf("mappings[%d].target_label 不能为空", i)
		}
		if strings.TrimSpace(string(m.SourceType)) == "" {
			return fmt.Errorf("mappings[%d].source_type 不能为空", i)
		}
		if !validSourceType(m.SourceType) {
			return fmt.Errorf("mappings[%d].source_type %q 非法，可选：resource_field/composite/prometheus_builtin/cmdb_field", i, m.SourceType)
		}
		if strings.TrimSpace(m.SourceField) == "" {
			return fmt.Errorf("mappings[%d].source_field 不能为空", i)
		}
		if err := validateTransformRule(strings.TrimSpace(m.Transform)); err != nil {
			return fmt.Errorf("mappings[%d]: %w", i, err)
		}
		if m.SourceType == models.LabelSourceTypeComposite && m.TargetLabel != mappingTargetInstance {
			return fmt.Errorf("mappings[%d]: composite 来源的目标标签必须为 instance", i)
		}
		if err := validateTargetLabel(m.SourceType, m.TargetLabel); err != nil {
			return fmt.Errorf("mappings[%d]: %w", i, err)
		}
		if _, dup := seen[m.TargetLabel]; dup {
			return fmt.Errorf("mappings[%d].target_label %q 在模板内重复，target_label 必须唯一", i, m.TargetLabel)
		}
		seen[m.TargetLabel] = struct{}{}
	}
	return nil
}

// templateExistsByNameCategory 报告活跃（未软删）模板中是否存在同名同类型，用于
// POST 创建与 clone 的冲突校验（PRD §6.6.3：同名同资源类型 → conflict）。
func templateExistsByNameCategory(db *gorm.DB, name string, cat models.ResourceCategory) (bool, error) {
	var count int64
	if err := db.Model(&models.LabelTemplate{}).
		Where("name = ? AND resource_category = ?", name, cat).
		Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

// CreateLabelTemplate 是 POST /api/v2/platform/label-templates 的 handler：
// 创建 is_default=false 的模板；同名同类型返回 conflict；mappings 传入时走
// validateMappings；每次创建落一条 LabelTemplateSnapshot（operator=platform_admin，
// changed_mappings 记录新建映射 NewValue）。
func CreateLabelTemplate(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateLabelTemplateRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid label template payload: %w", err))
			return
		}
		if strings.TrimSpace(req.Name) == "" {
			response.BadRequest(c, fmt.Errorf("name 不能为空"))
			return
		}
		if !validResourceCategory(req.ResourceCategory) {
			response.BadRequest(c, fmt.Errorf("resource_category %q 非法，必须是 host/database/middleware/application/generic_target 之一", req.ResourceCategory))
			return
		}
		if len(req.Mappings) > 0 {
			if err := validateMappings(req.Mappings); err != nil {
				response.BadRequest(c, err)
				return
			}
		}

		// TODO(models): LabelTemplate 模型当前无 Description 列（本任务冻结
		// platform/models/），req.Description 解析后暂不落库；模型放开后在此写入
		// Description，并纳入 PUT「仅可改 name/description」的持久化范围。

		dup, err := templateExistsByNameCategory(db, req.Name, req.ResourceCategory)
		if err != nil {
			response.InternalServerError(c, fmt.Errorf("check duplicate label template: %w", err))
			return
		}
		if dup {
			response.Conflict(c, fmt.Errorf("标签模板 %q（%s）已存在", req.Name, req.ResourceCategory))
			return
		}

		tmpl := &models.LabelTemplate{
			Name:             req.Name,
			ResourceCategory: req.ResourceCategory,
			IsDefault:        false, // 创建模板恒非默认（PRD §6.3 / §6.6.3）
			Mappings:         req.Mappings,
		}
		// 模板创建与快照写入置于同一事务（dev-feedback L-1）：快照失败时回滚
		// 模板创建，避免「模板已建但快照缺失」的审计缺口。
		err = db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Create(tmpl).Error; err != nil {
				return fmt.Errorf("create label template %q: %w", req.Name, err)
			}
			if err := appendTemplateSnapshot(tx, tmpl.ID, newMappingChanges(tmpl.Mappings)); err != nil {
				return fmt.Errorf("append label template snapshot: %w", err)
			}
			return nil
		})
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, tmpl)
	}
}

// UpdateLabelTemplate 是 PUT /api/v2/platform/label-templates/:template_id 的
// handler：仅可改 name（description 待模型放开）；resource_category 创建后不可改，
// 传入不同值返回 bad_request；未命中 not_found。每次更新落一条快照。
func UpdateLabelTemplate(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseTemplateID(c)
		if !ok {
			response.BadRequest(c, fmt.Errorf("template_id 非法"))
			return
		}
		var req UpdateLabelTemplateRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid label template payload: %w", err))
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

		// resource_category 创建后不可改（PRD §6.6.3）。
		if req.ResourceCategory != nil && *req.ResourceCategory != tmpl.ResourceCategory {
			response.BadRequest(c, fmt.Errorf("resource_category 创建后不可改（当前 %q）", tmpl.ResourceCategory))
			return
		}

		if req.Name != nil {
			if strings.TrimSpace(*req.Name) == "" {
				response.BadRequest(c, fmt.Errorf("name 不能为空"))
				return
			}
			tmpl.Name = *req.Name
		}
		// TODO(models): Description 暂不落库（模型无该列，本任务冻结 models/）。

		// 模板更新与快照写入置于同一事务（dev-feedback L-1）。
		if err := db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Model(&tmpl).Update("name", tmpl.Name).Error; err != nil {
				return fmt.Errorf("update label template %d: %w", id, err)
			}
			if err := appendTemplateSnapshot(tx, tmpl.ID, nil); err != nil {
				return fmt.Errorf("append label template snapshot: %w", err)
			}
			return nil
		}); err != nil {
			response.InternalServerError(c, err)
			return
		}
		// 重新读取以返回最新持久化状态（含时间戳）。
		if err := db.First(&tmpl, id).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("reload label template %d: %w", id, err))
			return
		}
		response.OK(c, tmpl)
	}
}

// DeleteLabelTemplate 是 DELETE /api/v2/platform/label-templates/:template_id 的
// handler，校验分两级且语义分离（Module_07 §6.6.3.1）：
//
//  1. is_default=true 模板拒绝删除 → bad_request「默认模板禁止删除」。这是模板
//     **自身属性**约束，与外部引用无关，故**先于**引用校验执行；
//  2. 存在非软删引用（采集 Job 或 CI 类型映射，含停用引用）→ forbidden「被引用
//     禁止删除」，data 回传 {reason: "referenced", refs, total}。
//
// 两级都通过后软删并落快照（记录被移除映射 OldValue）。成功返回 `{template_id}`。
//
// src 为引用清单数据源（TemplateReferenceSource），必须由装配层注入
// NewTemplateReferenceSource(db)；**未注入（nil）时保守拒绝而非跳过校验**——
// 静默跳过引用校验等于放任静默漂移，与本决策的初衷相反。
func DeleteLabelTemplate(db *gorm.DB, src TemplateReferenceSource) gin.HandlerFunc {
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
		if tmpl.IsDefault {
			response.BadRequest(c, fmt.Errorf("默认模板禁止删除，请基于默认模板克隆后管理自定义模板"))
			return
		}

		// 引用保护（Module_07 §6.6.3.1）：模板一旦被采集配置引用就删除，生成链路
		// LoadTemplateForJob 会在模板查不到时**静默回落**该类别的默认模板
		// （configcenter/generator/data_source.go），生成继续成功、不报错、不告警，
		// target 上的 label 集被悄悄换掉，告警匹配与看板分组随之失效——比直接生成
		// 失败更危险，因此必须在删除前拦住。
		//
		// 数据源为 M01 拥有的两张表的只读查询（references.go 窄接口隔离），M07 不
		// 新增任何写路径。停用（enabled=false）引用同样计入：停用 Job 可随时原地
		// 复用且其 target 配置仍留在已下发的 prometheus.yml 中未回收，删模板会让
		// 「恢复启用」在无感知的情况下换掉标签集；软删行不计入（由 GORM 自动过滤）。
		if src == nil {
			// 未装配引用数据源属装配错误，同样保守拒绝：不得因「查不到引用源」而
			// 放行删除。
			response.InternalServerError(c, fmt.Errorf(
				"标签模板 %d 的引用校验数据源未装配，已拒绝删除", id))
			return
		}
		refs, err := src.ListReferences(id)
		if err != nil {
			// 查不到引用 ≠ 没有引用。此处必须保守拒绝（internal_server_error），
			// 绝不能把查询失败当成「无引用」而放行删除——那正是本决策要防的静默
			// 漂移。宁可拦住一次合法删除，也不冒配置静默改写的风险。
			response.InternalServerError(c, fmt.Errorf(
				"校验标签模板 %d 的引用方失败，为避免静默改写采集配置已拒绝删除，请稍后重试: %w", id, err))
			return
		}
		if len(refs) > 0 {
			// 解绑 → 删除闭环无需新增写接口（§6.6.3.1 第 4 点）：改绑走 M01 的
			// PUT /scrape-jobs/{job_id} 更新 label_template_id，废弃则删除该 Job，
			// 两条路径均已存在，故此处只给出明确出路而不代为改绑。
			//
			// forbidden 需同时满足两件事，故不走 response.Forbidden：
			//  1. 统一信封 {status, errorType, error}（PRD §6.6 通用格式）；
			//  2. 额外回传结构化 data {reason, refs, total}（§6.6.3.1 第 3 点），
			//     供前端定位要解绑哪些对象——单靠 error 文案无法驱动交互。
			c.JSON(http.StatusForbidden, response.Response{
				Status:    response.StatusError,
				ErrorType: response.ErrorTypeForbidden,
				Error:     referencedDeleteMessage(refs),
				Data:      gin.H{"reason": "referenced", "refs": refs, "total": len(refs)},
			})
			return
		}

		removed := removedMappingChanges(tmpl.Mappings)
		// 模板删除与快照写入置于同一事务（dev-feedback L-1）：快照失败回滚软删，
		// 保证「已删模板必有移除快照」的审计一致性。
		if err := db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Delete(&tmpl).Error; err != nil {
				return fmt.Errorf("delete label template %d: %w", id, err)
			}
			if err := appendTemplateSnapshot(tx, tmpl.ID, removed); err != nil {
				return fmt.Errorf("append label template snapshot: %w", err)
			}
			return nil
		}); err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, gin.H{"template_id": id})
	}
}

// referencedDeleteMessage 生成「被引用禁删」的 403 提示文案（Module_07 §6.6.3.1
// 第 4 点：文案须明确引导「先改绑或删除引用方，再删除模板」，而非仅给出错误码）。
//
// 文案同时区分两类引用方：采集 Job 改绑 = 编辑 Job 的标签模板选择器；CI 类型映射
// 改绑 = 编辑该 monitor_type 映射的标签模板。停用（enabled=false）的 Job 也计入
// 引用，故额外提示「停用中」，避免用户误以为停用即可绕过。
func referencedDeleteMessage(refs []TemplateReference) string {
	var jobs, mappings, disabled int
	for _, r := range refs {
		switch r.Source {
		case RefSourceScrapeJob:
			jobs++
			if r.Enabled != nil && !*r.Enabled {
				disabled++
			}
		case RefSourceCIMapping:
			mappings++
		}
	}

	var b strings.Builder
	fmt.Fprintf(&b, "标签模板被 %d 个采集配置引用，禁止删除。请先改绑或删除引用方，再删除本模板：", len(refs))
	if jobs > 0 {
		fmt.Fprintf(&b, "采集 Job %d 个（改绑请编辑该 Job 的标签模板选择器，或直接删除该 Job）", jobs)
		if disabled > 0 {
			fmt.Fprintf(&b, "，其中 %d 个处于停用状态——停用不解除引用，仍需改绑或删除", disabled)
		}
		b.WriteString("；")
	}
	if mappings > 0 {
		fmt.Fprintf(&b, "CI 类型映射 %d 个（改绑请编辑对应映射的标签模板，或删除该映射）", mappings)
		b.WriteString("；")
	}
	b.WriteString("解绑后需重新生成并确认下发采集配置。")
	return b.String()
}

// parseTemplateID 解析路径参数 template_id 为正整数；非法/缺省返回 false。
func parseTemplateID(c *gin.Context) (uint, bool) {
	raw := c.Param("template_id")
	id, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || id == 0 {
		return 0, false
	}
	return uint(id), true
}

// appendTemplateSnapshot 追加一条只读修改快照（Module_07 §3.2 / §5.3）：仅追加、
// 不提供查询/回滚 API；operator 固定 platform_admin。
//
// 契约：必须与主变更操作置于同一事务内调用（传事务句柄 tx），保证快照失败时
// 主操作一并回滚（dev-feedback L-1 已对全部调用点包裹 db.Transaction）。
func appendTemplateSnapshot(db *gorm.DB, templateID uint, changes []models.MappingChange) error {
	if changes == nil {
		changes = []models.MappingChange{}
	}
	snap := &models.LabelTemplateSnapshot{
		TemplateID:      templateID,
		Operator:        snapshotOperator,
		ChangedMappings: changes,
	}
	return db.Create(snap).Error
}

// newMappingChanges 将全量 mappings 转为「新增」快照变更（OldValue 为空、NewValue
// 为当前映射），用于 create / clone。
func newMappingChanges(mappings []models.LabelMapping) []models.MappingChange {
	changes := make([]models.MappingChange, 0, len(mappings))
	for i := range mappings {
		m := mappings[i]
		changes = append(changes, models.MappingChange{
			TargetLabel: m.TargetLabel,
			NewValue:    &m,
		})
	}
	return changes
}

// removedMappingChanges 将全量 mappings 转为「移除」快照变更（OldValue 为原映射、
// NewValue 为空），用于 delete。
func removedMappingChanges(mappings []models.LabelMapping) []models.MappingChange {
	changes := make([]models.MappingChange, 0, len(mappings))
	for i := range mappings {
		m := mappings[i]
		changes = append(changes, models.MappingChange{
			TargetLabel: m.TargetLabel,
			OldValue:    &m,
		})
	}
	return changes
}
