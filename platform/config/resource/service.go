// 本文件提供服务字典 ServiceDict 的对外接口（决策 105/112，契约快照 §5D /
// Module_07 §5.22）：只读列表 + 登记 + 受限编辑；编码创建后不可变、展示名必填、
// 停用不删除（无删除接口）。字典是 `svc` label 的取值权威，并以可空 app_code /
// biz_code 显式承载应用↔服务、服务↔业务关系。
package resource

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// ServiceDict 是服务字典的对外传输视图（DTO，契约快照 §5D）。
//
//   - service_code 不可变主键，创建后不可改、停用不删除；
//   - service_name 展示名，必填，可改（改展示名不触发配置重生成，label 取编码）；
//   - app_code     可空所属应用，是应用↔服务 1:N 的关系权威；
//   - biz_code     可空主业务，是服务↔业务 N:1 的关系权威；
//   - description  描述，可改；
//   - enabled      启用状态；停用条目不可被新资源 / 编辑选用（资源保留历史值）。
type ServiceDict struct {
	ServiceCode string `json:"service_code"`
	ServiceName string `json:"service_name"`
	AppCode     string `json:"app_code,omitempty"`
	BizCode     string `json:"biz_code,omitempty"`
	Description string `json:"description"`
	Enabled     bool   `json:"enabled"`
}

// ServiceDictStore 是服务字典的 DB-backed 读写访问门面（决策 105）。
type ServiceDictStore struct {
	db *gorm.DB
}

// NewServiceDictStore 以给定 DB 连接构造服务字典 store。db 非空（构造于 DB 迁移
// 之后）；nil 时 store 所有读取返回错误。
func NewServiceDictStore(db *gorm.DB) *ServiceDictStore {
	return &ServiceDictStore{db: db}
}

// toServiceDict 将持久化模型转换为 API 传输视图（仅暴露字典字段）。
func toServiceDict(m models.ServiceDict) ServiceDict {
	return ServiceDict{
		ServiceCode: m.ServiceCode,
		ServiceName: m.ServiceName,
		AppCode:     m.AppCode,
		BizCode:     m.BizCode,
		Description: m.Description,
		Enabled:     m.Enabled,
	}
}

// List 返回全量字典条目（含停用项，按 id 稳定排序）。
func (s *ServiceDictStore) List() ([]ServiceDict, error) {
	var rows []models.ServiceDict
	if err := s.db.Order("id ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("查询服务字典：%w", err)
	}
	out := make([]ServiceDict, 0, len(rows))
	for _, r := range rows {
		out = append(out, toServiceDict(r))
	}
	return out, nil
}

// Lookup 按 service_code 查找条目（含停用项）。ok=false 表示不存在。
func (s *ServiceDictStore) Lookup(code string) (ServiceDict, bool, error) {
	if s == nil || s.db == nil {
		return ServiceDict{}, false, fmt.Errorf("服务字典未初始化：store 为空")
	}
	var m models.ServiceDict
	err := s.db.Where("service_code = ?", code).First(&m).Error
	switch {
	case err == gorm.ErrRecordNotFound:
		return ServiceDict{}, false, nil
	case err != nil:
		return ServiceDict{}, false, fmt.Errorf("查询服务 %s：%w", code, err)
	default:
		return toServiceDict(m), true, nil
	}
}

// EnabledList 返回启用条目（停用项不进入）。
func (s *ServiceDictStore) EnabledList() ([]ServiceDict, error) {
	var rows []models.ServiceDict
	if err := s.db.Where("enabled = ?", true).Order("id ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("查询启用服务：%w", err)
	}
	out := make([]ServiceDict, 0, len(rows))
	for _, r := range rows {
		out = append(out, toServiceDict(r))
	}
	return out, nil
}

// GetEnabledMap 返回启用条目映射 service_code -> ServiceDict，供资源行 service_code
// 校验消费（只允许引用未停用条目）。
func (s *ServiceDictStore) GetEnabledMap() (map[string]ServiceDict, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("服务字典未初始化：store 为空")
	}
	var rows []models.ServiceDict
	if err := s.db.Where("enabled = ?", true).Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("查询启用服务：%w", err)
	}
	out := make(map[string]ServiceDict, len(rows))
	for _, r := range rows {
		out[r.ServiceCode] = toServiceDict(r)
	}
	return out, nil
}

// Create 落一条新服务条目（默认 enabled、source=manual），返回持久化后的 DTO。
func (s *ServiceDictStore) Create(m models.ServiceDict) (ServiceDict, error) {
	if err := s.db.Create(&m).Error; err != nil {
		return ServiceDict{}, fmt.Errorf("创建服务 %s 失败：%w", m.ServiceCode, err)
	}
	return toServiceDict(m), nil
}

// Update 受限编辑服务条目（PRD §5.22 红线②）：仅 service_name / description /
// enabled / app_code / biz_code 可改；service_code 不可改由 handler 请求体约束。
// 无 DELETE 入口（停用不删除）。
func (s *ServiceDictStore) Update(code string, req UpdateServiceDictRequest) (ServiceDict, error) {
	var m models.ServiceDict
	if err := s.db.Where("service_code = ?", code).First(&m).Error; err != nil {
		return ServiceDict{}, fmt.Errorf("查询服务 %s：%w", code, err)
	}
	if req.ServiceName != nil {
		m.ServiceName = *req.ServiceName
	}
	if req.Description != nil {
		m.Description = *req.Description
	}
	if req.Enabled != nil {
		m.Enabled = *req.Enabled
	}
	if req.AppCode != nil {
		m.AppCode = strings.TrimSpace(*req.AppCode)
	}
	if req.BizCode != nil {
		m.BizCode = strings.TrimSpace(*req.BizCode)
	}
	if err := s.db.Save(&m).Error; err != nil {
		return ServiceDict{}, fmt.Errorf("更新服务 %s 失败：%w", code, err)
	}
	return toServiceDict(m), nil
}

// CreateServiceDictRequest 是登记服务的请求体（决策 105/112）：service_code 创建后不可改，
// app_code / biz_code 为可空关系字段。
type CreateServiceDictRequest struct {
	ServiceCode string `json:"service_code"`
	ServiceName string `json:"service_name"`
	AppCode     string `json:"app_code,omitempty"`
	BizCode     string `json:"biz_code,omitempty"`
	Description string `json:"description"`
}

// UpdateServiceDictRequest 是受限编辑服务的请求体：仅接受 service_name /
// description / enabled / app_code / biz_code；不接收 service_code（创建后永不可改）。
type UpdateServiceDictRequest struct {
	ServiceName *string `json:"service_name"`
	AppCode     *string `json:"app_code,omitempty"`
	BizCode     *string `json:"biz_code,omitempty"`
	Description *string `json:"description"`
	Enabled     *bool   `json:"enabled"`
}

// validateCreateServiceDict 纯函数校验登记请求：编码规范（小写字母/数字/连字符
// ≤64）与 service_name 非空。返回含人读文案的错误，供 handler 包装为 bad_request。
func validateCreateServiceDict(req *CreateServiceDictRequest) error {
	req.ServiceCode = strings.TrimSpace(req.ServiceCode)
	req.ServiceName = strings.TrimSpace(req.ServiceName)
	req.AppCode = strings.TrimSpace(req.AppCode)
	req.BizCode = strings.TrimSpace(req.BizCode)
	if !models.ValidServiceCode.MatchString(req.ServiceCode) {
		return fmt.Errorf("服务编码仅允许小写字母、数字和连字符，长度不超过 64")
	}
	if req.ServiceName == "" {
		return fmt.Errorf("service_name 必填")
	}
	return nil
}

func validateServiceRelationRefs(appStore *ApplicationDictStore, bizStore *BusinessDomainStore, appCode, bizCode string) error {
	appCode = strings.TrimSpace(appCode)
	bizCode = strings.TrimSpace(bizCode)
	if appCode != "" {
		app, found, err := appStore.Lookup(appCode)
		if err != nil {
			return fmt.Errorf("应用字典加载失败：%w", err)
		}
		if !found || app.Status != models.AppStatusEnabled {
			return fmt.Errorf("应用 %s 未登记或已停用，请到『应用字典』登记或启用后重试", appCode)
		}
	}
	if bizCode != "" {
		biz, found, err := bizStore.Lookup(bizCode)
		if err != nil {
			return fmt.Errorf("业务字典加载失败：%w", err)
		}
		if !found || !biz.Enabled {
			return fmt.Errorf("业务 %s 未登记或已停用，请到『业务字典』登记或启用后重试", bizCode)
		}
	}
	return nil
}

// ListServiceDicts 是 GET /api/v2/platform/service-dict 的只读 handler。
// 返回 `{list:[{service_code,service_name,description,enabled}], total}`
// （契约快照 §5D，含停用项）。
func ListServiceDicts(store *ServiceDictStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		list, err := store.List()
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, gin.H{
			"list":  list,
			"total": len(list),
		})
	}
}

// CreateServiceDict 是 POST /api/v2/platform/service-dict 的登记 handler：
// body {service_code,service_name,description?,app_code?,biz_code?}；默认 enabled=true；
// 编码不规范 / 重码 / service_name 为空 / 关系码不可用 → bad_request。
func CreateServiceDict(store *ServiceDictStore, appStore *ApplicationDictStore, bizStore *BusinessDomainStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateServiceDictRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("请求体解析失败：%w", err))
			return
		}
		if err := validateCreateServiceDict(&req); err != nil {
			response.BadRequest(c, err)
			return
		}
		if err := validateServiceRelationRefs(appStore, bizStore, req.AppCode, req.BizCode); err != nil {
			response.BadRequest(c, err)
			return
		}
		_, found, err := store.Lookup(req.ServiceCode)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if found {
			response.BadRequest(c, fmt.Errorf("该服务编码已存在：%s", req.ServiceCode))
			return
		}
		created, err := store.Create(models.ServiceDict{
			ServiceCode: req.ServiceCode,
			ServiceName: req.ServiceName,
			AppCode:     req.AppCode,
			BizCode:     req.BizCode,
			Description: req.Description,
			Enabled:     true,                    // 登记默认启用（决策 105）
			Source:      models.DictSourceManual, // 来源服务端设定（决策 97 延伸）
		})
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, created)
	}
}

// UpdateServiceDict 是 PUT /api/v2/platform/service-dict/:service_code 的受限编辑
// handler：仅 service_name/description/enabled/app_code/biz_code 可改；无 DELETE 入口。
func UpdateServiceDict(store *ServiceDictStore, appStore *ApplicationDictStore, bizStore *BusinessDomainStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		code := strings.TrimSpace(c.Param("service_code"))
		if code == "" {
			response.BadRequest(c, fmt.Errorf("service_code 必填"))
			return
		}
		var req UpdateServiceDictRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("请求体解析失败：%w", err))
			return
		}
		if req.ServiceName != nil && strings.TrimSpace(*req.ServiceName) == "" {
			response.BadRequest(c, fmt.Errorf("service_name 不能为空"))
			return
		}
		var appCode, bizCode string
		if req.AppCode != nil {
			*req.AppCode = strings.TrimSpace(*req.AppCode)
			appCode = *req.AppCode
		}
		if req.BizCode != nil {
			*req.BizCode = strings.TrimSpace(*req.BizCode)
			bizCode = *req.BizCode
		}
		if err := validateServiceRelationRefs(appStore, bizStore, appCode, bizCode); err != nil {
			response.BadRequest(c, err)
			return
		}
		_, found, err := store.Lookup(code)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if !found {
			response.NotFound(c, fmt.Sprintf("服务 %s 不存在", code))
			return
		}
		updated, err := store.Update(code, req)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, updated)
	}
}
