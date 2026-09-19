package resource

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// ApplicationDict 是应用字典的对外传输视图（DTO，决策 92：与业务分组同构）。
//
//   - app_code    不可变主键，创建后不可改、停用不删除（PRD 红线）；
//   - app_name    展示名，可改，仅 UI 展示，修改不触发监控配置重生成/下发；
//   - description 描述，可改；
//   - status      启用状态 enabled/disabled；停用不删除，停用条目不可被新资源选用。
//
// 端点路径建议 GET/POST /api/v2/platform/application-dict（与 business-domains 同构）；
// 口径：资源侧 app_code 只允许引用未停用条目（录入/编辑/Excel 导入三处同校验）。
type ApplicationDict struct {
	AppCode     string `json:"app_code"`
	AppName     string `json:"app_name"`
	Description string `json:"description"`
	Status      string `json:"status"`
}

// ApplicationDictStore 是应用字典的 DB-backed 只读/读写访问门面（决策 92）。
// 字典权威存储为 DB（models.ApplicationDict 表），首次启动经 seed 从存量资源取值
// 生成；本 store 聚合 DB 读写，并对消费方暴露只读签名（List/Lookup/EnabledList/
// GetEnabledMap），使资源校验、Excel 导入、模板下载调用方一致。
type ApplicationDictStore struct {
	db *gorm.DB
}

// NewApplicationDictStore 以给定 DB 连接构造应用字典 store。db 非空（构造于 DB 迁移
// 之后）；nil 时 store 所有读取返回错误。
func NewApplicationDictStore(db *gorm.DB) *ApplicationDictStore {
	return &ApplicationDictStore{db: db}
}

// toApplicationDict 将持久化模型转换为 API 传输视图（仅暴露字典字段）。
func toApplicationDict(m models.ApplicationDict) ApplicationDict {
	return ApplicationDict{
		AppCode:     m.AppCode,
		AppName:     m.AppName,
		Description: m.Description,
		Status:      m.Status,
	}
}

// List 返回全量字典条目（含停用项，按 id 稳定排序）。
func (s *ApplicationDictStore) List() ([]ApplicationDict, error) {
	var rows []models.ApplicationDict
	if err := s.db.Order("id ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("查询应用字典：%w", err)
	}
	out := make([]ApplicationDict, 0, len(rows))
	for _, r := range rows {
		out = append(out, toApplicationDict(r))
	}
	return out, nil
}

// Lookup 按 app_code 查找条目。ok=false 表示不存在。
func (s *ApplicationDictStore) Lookup(code string) (ApplicationDict, bool, error) {
	if s == nil || s.db == nil {
		return ApplicationDict{}, false, fmt.Errorf("应用字典未初始化：store 为空")
	}
	var m models.ApplicationDict
	err := s.db.Where("app_code = ?", code).First(&m).Error
	switch {
	case err == gorm.ErrRecordNotFound:
		return ApplicationDict{}, false, nil
	case err != nil:
		return ApplicationDict{}, false, fmt.Errorf("查询应用 %s：%w", code, err)
	default:
		return toApplicationDict(m), true, nil
	}
}

// EnabledList 返回启用条目（停用项不进入，决策 92）。
func (s *ApplicationDictStore) EnabledList() ([]ApplicationDict, error) {
	var rows []models.ApplicationDict
	if err := s.db.Where("status = ?", models.AppStatusEnabled).Order("id ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("查询启用应用：%w", err)
	}
	out := make([]ApplicationDict, 0, len(rows))
	for _, r := range rows {
		out = append(out, toApplicationDict(r))
	}
	return out, nil
}

// GetEnabledMap 返回启用条目映射 app_code -> ApplicationDict，供资源校验
// （app_code 必填且对应启用条目，决策 92）。
func (s *ApplicationDictStore) GetEnabledMap() (map[string]ApplicationDict, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("应用字典未初始化：store 为空")
	}
	var rows []models.ApplicationDict
	if err := s.db.Where("status = ?", models.AppStatusEnabled).Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("查询启用应用：%w", err)
	}
	out := make(map[string]ApplicationDict, len(rows))
	for _, r := range rows {
		out[r.AppCode] = toApplicationDict(r)
	}
	return out, nil
}

// Create 落一条新应用（默认 enabled），返回持久化后的 DTO。
func (s *ApplicationDictStore) Create(m models.ApplicationDict) (ApplicationDict, error) {
	if err := s.db.Create(&m).Error; err != nil {
		return ApplicationDict{}, fmt.Errorf("创建应用 %s 失败：%w", m.AppCode, err)
	}
	return toApplicationDict(m), nil
}

// Update 受限编辑应用字典（决策 92）：仅名称/描述/状态可改；app_code 不可改由
// handler 请求体约束（不接收 app_code）。无 DELETE 入口（停用不删除）。
func (s *ApplicationDictStore) Update(code string, req UpdateApplicationDictRequest) (ApplicationDict, error) {
	var m models.ApplicationDict
	if err := s.db.Where("app_code = ?", code).First(&m).Error; err != nil {
		return ApplicationDict{}, fmt.Errorf("查询应用 %s：%w", code, err)
	}
	if req.AppName != nil {
		m.AppName = *req.AppName
	}
	if req.Description != nil {
		m.Description = *req.Description
	}
	if req.Status != nil {
		m.Status = *req.Status
	}
	if err := s.db.Save(&m).Error; err != nil {
		return ApplicationDict{}, fmt.Errorf("更新应用 %s 失败：%w", code, err)
	}
	return toApplicationDict(m), nil
}

// CreateApplicationDictRequest 是登记应用的请求体（决策 92）：app_code 创建后不可改。
type CreateApplicationDictRequest struct {
	AppCode     string `json:"app_code"`
	AppName     string `json:"app_name"`
	Description string `json:"description"`
}

// UpdateApplicationDictRequest 是受限编辑应用的请求体（决策 92）：仅接受
// app_name/description/status；不接收 app_code（app_code 创建后不可改）。
type UpdateApplicationDictRequest struct {
	AppName     *string `json:"app_name"`
	Description *string `json:"description"`
	Status      *string `json:"status"`
}

// validateCreateApplicationDict 纯函数校验登记请求：编码规范（小写字母/数字/连字符
// ≤64）与 app_name 非空。返回含人读文案的错误，供 handler 包装为 bad_request。
func validateCreateApplicationDict(req *CreateApplicationDictRequest) error {
	req.AppCode = strings.TrimSpace(req.AppCode)
	req.AppName = strings.TrimSpace(req.AppName)
	if !models.ValidAppCode.MatchString(req.AppCode) {
		return fmt.Errorf("应用编码仅允许小写字母、数字和连字符，长度不超过 64")
	}
	if req.AppName == "" {
		return fmt.Errorf("app_name 必填")
	}
	return nil
}

// ListApplicationDicts 是 GET /api/v2/platform/application-dict 的只读 handler。
// 返回 `{list:[{app_code,app_name,description,status}], total}`。
func ListApplicationDicts(store *ApplicationDictStore) gin.HandlerFunc {
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

// CreateApplicationDict 是 POST /api/v2/platform/application-dict 的登记 handler
// （决策 92）：body {app_code,app_name,description}；默认 enabled=true；编码不规范/
// 重名/app_name 为空 → bad_request。
func CreateApplicationDict(store *ApplicationDictStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateApplicationDictRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("请求体解析失败：%w", err))
			return
		}
		if err := validateCreateApplicationDict(&req); err != nil {
			response.BadRequest(c, err)
			return
		}
		_, found, err := store.Lookup(req.AppCode)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if found {
			response.BadRequest(c, fmt.Errorf("该应用编码已存在：%s", req.AppCode))
			return
		}
		created, err := store.Create(models.ApplicationDict{
			AppCode:     req.AppCode,
			AppName:     req.AppName,
			Description: req.Description,
			Status:      models.AppStatusEnabled, // 登记默认启用（决策 92）
		})
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, created)
	}
}

// UpdateApplicationDict 是 PUT /api/v2/platform/application-dict/:app_code 的受限
// 编辑 handler（决策 92）：仅 app_name/description/status 可改；无 DELETE 入口
// （停用不删除）。
func UpdateApplicationDict(store *ApplicationDictStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		code := strings.TrimSpace(c.Param("app_code"))
		if code == "" {
			response.BadRequest(c, fmt.Errorf("app_code 必填"))
			return
		}
		var req UpdateApplicationDictRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("请求体解析失败：%w", err))
			return
		}
		if req.AppName != nil && strings.TrimSpace(*req.AppName) == "" {
			response.BadRequest(c, fmt.Errorf("app_name 不能为空"))
			return
		}
		if req.Status != nil && *req.Status != models.AppStatusEnabled && *req.Status != models.AppStatusDisabled {
			response.BadRequest(c, fmt.Errorf("status 仅允许 enabled/disabled"))
			return
		}
		_, found, err := store.Lookup(code)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if !found {
			response.NotFound(c, fmt.Sprintf("应用 %s 不存在", code))
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
