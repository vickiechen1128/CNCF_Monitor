// 本文件提供平台字典 PlatformDict 的对外接口（决策 104，契约快照 §5C /
// Module_07 §5.21）：只读列表 + 登记 + 受限编辑；编码创建后不可变、展示名必填、
// 停用不删除（无删除接口）。字典与应用字典（application_dict.go）同构，供应用
// 条目的可选父级 platform_code 校验消费（决策 104/107）。
package resource

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// PlatformDict 是平台字典的对外传输视图（DTO，契约快照 §5C）。
//
//   - platform_code 不可变主键，创建后不可改、停用不删除；
//   - platform_name 展示名，必填，可改（改展示名不触发配置重生成，label 取编码）；
//   - description   描述，可改；
//   - enabled       启用状态；停用条目不可被新登记 / 编辑中的应用引用。
type PlatformDict struct {
	PlatformCode string `json:"platform_code"`
	PlatformName string `json:"platform_name"`
	Description  string `json:"description"`
	Enabled      bool   `json:"enabled"`
}

// PlatformDictStore 是平台字典的 DB-backed 读写访问门面（决策 104）。
// 与 ApplicationDictStore 同构：权威存储为 DB。
type PlatformDictStore struct {
	db *gorm.DB
}

// NewPlatformDictStore 以给定 DB 连接构造平台字典 store。db 非空（构造于 DB 迁移
// 之后）；nil 时 store 所有读取返回错误。
func NewPlatformDictStore(db *gorm.DB) *PlatformDictStore {
	return &PlatformDictStore{db: db}
}

// toPlatformDict 将持久化模型转换为 API 传输视图（仅暴露字典字段）。
func toPlatformDict(m models.PlatformDict) PlatformDict {
	return PlatformDict{
		PlatformCode: m.PlatformCode,
		PlatformName: m.PlatformName,
		Description:  m.Description,
		Enabled:      m.Enabled,
	}
}

// List 返回全量字典条目（含停用项，按 id 稳定排序）。
func (s *PlatformDictStore) List() ([]PlatformDict, error) {
	var rows []models.PlatformDict
	if err := s.db.Order("id ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("查询平台字典：%w", err)
	}
	out := make([]PlatformDict, 0, len(rows))
	for _, r := range rows {
		out = append(out, toPlatformDict(r))
	}
	return out, nil
}

// Lookup 按 platform_code 查找条目（含停用项）。ok=false 表示不存在。
func (s *PlatformDictStore) Lookup(code string) (PlatformDict, bool, error) {
	if s == nil || s.db == nil {
		return PlatformDict{}, false, fmt.Errorf("平台字典未初始化：store 为空")
	}
	var m models.PlatformDict
	err := s.db.Where("platform_code = ?", code).First(&m).Error
	switch {
	case err == gorm.ErrRecordNotFound:
		return PlatformDict{}, false, nil
	case err != nil:
		return PlatformDict{}, false, fmt.Errorf("查询平台 %s：%w", code, err)
	default:
		return toPlatformDict(m), true, nil
	}
}

// EnabledList 返回启用条目（停用项不进入）。
func (s *PlatformDictStore) EnabledList() ([]PlatformDict, error) {
	var rows []models.PlatformDict
	if err := s.db.Where("enabled = ?", true).Order("id ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("查询启用平台：%w", err)
	}
	out := make([]PlatformDict, 0, len(rows))
	for _, r := range rows {
		out = append(out, toPlatformDict(r))
	}
	return out, nil
}

// GetEnabledMap 返回启用条目映射 platform_code -> PlatformDict，供应用条目父级
// platform_code 校验消费（只允许引用未停用条目）。
func (s *PlatformDictStore) GetEnabledMap() (map[string]PlatformDict, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("平台字典未初始化：store 为空")
	}
	var rows []models.PlatformDict
	if err := s.db.Where("enabled = ?", true).Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("查询启用平台：%w", err)
	}
	out := make(map[string]PlatformDict, len(rows))
	for _, r := range rows {
		out[r.PlatformCode] = toPlatformDict(r)
	}
	return out, nil
}

// Create 落一条新平台条目（默认 enabled、source=manual），返回持久化后的 DTO。
func (s *PlatformDictStore) Create(m models.PlatformDict) (PlatformDict, error) {
	if err := s.db.Create(&m).Error; err != nil {
		return PlatformDict{}, fmt.Errorf("创建平台 %s 失败：%w", m.PlatformCode, err)
	}
	return toPlatformDict(m), nil
}

// UpdateEnabledNameDesc 受限编辑平台条目（PRD §5.21 红线②）：仅 platform_name /
// description / enabled 可改；platform_code 不可改由 handler 请求体约束（不接收
// platform_code）。无 DELETE 入口（停用不删除）。
func (s *PlatformDictStore) UpdateEnabledNameDesc(code string, req UpdatePlatformDictRequest) (PlatformDict, error) {
	var m models.PlatformDict
	if err := s.db.Where("platform_code = ?", code).First(&m).Error; err != nil {
		return PlatformDict{}, fmt.Errorf("查询平台 %s：%w", code, err)
	}
	if req.PlatformName != nil {
		m.PlatformName = *req.PlatformName
	}
	if req.Description != nil {
		m.Description = *req.Description
	}
	if req.Enabled != nil {
		m.Enabled = *req.Enabled
	}
	if err := s.db.Save(&m).Error; err != nil {
		return PlatformDict{}, fmt.Errorf("更新平台 %s 失败：%w", code, err)
	}
	return toPlatformDict(m), nil
}

// CreatePlatformDictRequest 是登记平台的请求体（决策 104）：platform_code 创建后不可改。
type CreatePlatformDictRequest struct {
	PlatformCode string `json:"platform_code"`
	PlatformName string `json:"platform_name"`
	Description  string `json:"description"`
}

// UpdatePlatformDictRequest 是受限编辑平台的请求体：仅接受 platform_name /
// description / enabled；不接收 platform_code（创建后永不可改）。
type UpdatePlatformDictRequest struct {
	PlatformName *string `json:"platform_name"`
	Description  *string `json:"description"`
	Enabled      *bool   `json:"enabled"`
}

// validateCreatePlatformDict 纯函数校验登记请求：编码规范（小写字母/数字/连字符
// ≤64）与 platform_name 非空。返回含人读文案的错误，供 handler 包装为 bad_request。
func validateCreatePlatformDict(req *CreatePlatformDictRequest) error {
	req.PlatformCode = strings.TrimSpace(req.PlatformCode)
	req.PlatformName = strings.TrimSpace(req.PlatformName)
	if !models.ValidPlatformCode.MatchString(req.PlatformCode) {
		return fmt.Errorf("平台编码仅允许小写字母、数字和连字符，长度不超过 64")
	}
	if req.PlatformName == "" {
		return fmt.Errorf("platform_name 必填")
	}
	return nil
}

// ListPlatformDicts 是 GET /api/v2/platform/platform-dict 的只读 handler。
// 返回 `{list:[{platform_code,platform_name,description,enabled}], total}`
// （契约快照 §5C，含停用项）。
func ListPlatformDicts(store *PlatformDictStore) gin.HandlerFunc {
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

// CreatePlatformDict 是 POST /api/v2/platform/platform-dict 的登记 handler：
// body {platform_code,platform_name,description?}；默认 enabled=true；编码不规范 /
// 重码 / platform_name 为空 → bad_request。
func CreatePlatformDict(store *PlatformDictStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreatePlatformDictRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("请求体解析失败：%w", err))
			return
		}
		if err := validateCreatePlatformDict(&req); err != nil {
			response.BadRequest(c, err)
			return
		}
		_, found, err := store.Lookup(req.PlatformCode)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if found {
			response.BadRequest(c, fmt.Errorf("该平台编码已存在：%s", req.PlatformCode))
			return
		}
		created, err := store.Create(models.PlatformDict{
			PlatformCode: req.PlatformCode,
			PlatformName: req.PlatformName,
			Description:  req.Description,
			Enabled:      true,                    // 登记默认启用（决策 104）
			Source:       models.DictSourceManual, // 来源服务端设定（决策 97 延伸）
		})
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, created)
	}
}

// UpdatePlatformDict 是 PUT /api/v2/platform/platform-dict/:platform_code 的受限
// 编辑 handler：仅 platform_name/description/enabled 可改；无 DELETE 入口。
func UpdatePlatformDict(store *PlatformDictStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		code := strings.TrimSpace(c.Param("platform_code"))
		if code == "" {
			response.BadRequest(c, fmt.Errorf("platform_code 必填"))
			return
		}
		var req UpdatePlatformDictRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("请求体解析失败：%w", err))
			return
		}
		if req.PlatformName != nil && strings.TrimSpace(*req.PlatformName) == "" {
			response.BadRequest(c, fmt.Errorf("platform_name 不能为空"))
			return
		}
		_, found, err := store.Lookup(code)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if !found {
			response.NotFound(c, fmt.Sprintf("平台 %s 不存在", code))
			return
		}
		updated, err := store.UpdateEnabledNameDesc(code, req)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, updated)
	}
}
