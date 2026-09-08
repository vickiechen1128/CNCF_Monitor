// Package resource implements Module 07 监控对象管理的支撑层：业务分组字典、
// 资源校验与查询辅助等。本文件提供业务分组字典的 DB-backed 访问（决策 48）：
// 权威存储为 DB，business_domains.yaml 仅首次启动 seed；消费沿用
// GetEnabledMap()/EnabledList() 只读签名，资源 CRUD / Excel 导入 / 模板下载调用方不变。
package resource

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// BusinessDomain 是业务分组字典的对外传输视图（DTO）。
//
//   - code        不可变主键（biz_code），永不可改、停用不删除（PRD §3.1 红线）；
//   - name        展示名（biz_name），可改，仅 UI 展示；
//   - description 描述，可改；
//   - enabled     启用状态；停用条目不可被新资源/新增/编辑选用，存量资源保留历史值。
type BusinessDomain struct {
	Code        string `json:"code"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Enabled     bool   `json:"enabled"`
}

// BusinessDomainStore 是业务分组字典的 DB-backed 只读/读写访问门面。
//
// 决策 48：字典权威存储为 platform DB（models.BusinessDomain 表），数据由首次启动
// seed 导入；本 store 聚合 DB 读写，并对消费方暴露原有只读签名（List/Lookup/
// EnabledList/GetEnabledMap），使资源校验、Excel 导入、模板下载调用方不被破坏。
type BusinessDomainStore struct {
	db *gorm.DB
}

// NewBusinessDomainStore 以给定 DB 连接构造业务字典 store。db 非空（构造于 DB 迁移
// 之后）；nil 时 store 所有读取返回错误。
func NewBusinessDomainStore(db *gorm.DB) *BusinessDomainStore {
	return &BusinessDomainStore{db: db}
}

// toBusinessDomain 将持久化模型转换为 API 传输视图（仅暴露字典字段）。
func toBusinessDomain(m models.BusinessDomain) BusinessDomain {
	return BusinessDomain{
		Code:        m.Code,
		Name:        m.Name,
		Description: m.Description,
		Enabled:     m.Enabled,
	}
}

// List 返回全量字典条目（含停用项，按 id 稳定排序）。
func (s *BusinessDomainStore) List() ([]BusinessDomain, error) {
	var rows []models.BusinessDomain
	if err := s.db.Order("id ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("查询业务分组字典：%w", err)
	}
	out := make([]BusinessDomain, 0, len(rows))
	for _, r := range rows {
		out = append(out, toBusinessDomain(r))
	}
	return out, nil
}

// Lookup 按 code 查找条目。ok=false 表示不存在。
func (s *BusinessDomainStore) Lookup(code string) (BusinessDomain, bool, error) {
	var m models.BusinessDomain
	err := s.db.Where("code = ?", code).First(&m).Error
	switch {
	case err == gorm.ErrRecordNotFound:
		return BusinessDomain{}, false, nil
	case err != nil:
		return BusinessDomain{}, false, fmt.Errorf("查询业务分组 %s：%w", code, err)
	default:
		return toBusinessDomain(m), true, nil
	}
}

// EnabledList 返回启用条目（停用项不进入，PRD §3.1）。
func (s *BusinessDomainStore) EnabledList() ([]BusinessDomain, error) {
	var rows []models.BusinessDomain
	if err := s.db.Where("enabled = ?", true).Order("id ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("查询启用业务分组：%w", err)
	}
	out := make([]BusinessDomain, 0, len(rows))
	for _, r := range rows {
		out = append(out, toBusinessDomain(r))
	}
	return out, nil
}

// GetEnabledMap 返回启用条目映射 code -> BusinessDomain，供资源校验
// （biz_code 必填且对应启用条目，T07-03/T07-06）。
func (s *BusinessDomainStore) GetEnabledMap() (map[string]BusinessDomain, error) {
	var rows []models.BusinessDomain
	if err := s.db.Where("enabled = ?", true).Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("查询启用业务分组：%w", err)
	}
	out := make(map[string]BusinessDomain, len(rows))
	for _, r := range rows {
		out[r.Code] = toBusinessDomain(r)
	}
	return out, nil
}

// Create 落一条新业务分组（默认 enabled），返回持久化后的 DTO。
func (s *BusinessDomainStore) Create(m models.BusinessDomain) (BusinessDomain, error) {
	if err := s.db.Create(&m).Error; err != nil {
		return BusinessDomain{}, fmt.Errorf("创建业务分组 %s 失败：%w", m.Code, err)
	}
	return toBusinessDomain(m), nil
}

// Update 受限编辑业务分组（决策 48）：仅名称/描述/启用态可改；code 不可改由 handler
// 请求体约束（不接收 code）。infra 禁停用由 handler 校验，本方法不做二次限制。
func (s *BusinessDomainStore) Update(code string, req UpdateBusinessDomainRequest) (BusinessDomain, error) {
	var m models.BusinessDomain
	if err := s.db.Where("code = ?", code).First(&m).Error; err != nil {
		return BusinessDomain{}, fmt.Errorf("查询业务分组 %s：%w", code, err)
	}
	if req.Name != nil {
		m.Name = *req.Name
	}
	if req.Description != nil {
		m.Description = *req.Description
	}
	if req.Enabled != nil {
		m.Enabled = *req.Enabled
	}
	if err := s.db.Save(&m).Error; err != nil {
		return BusinessDomain{}, fmt.Errorf("更新业务分组 %s 失败：%w", code, err)
	}
	return toBusinessDomain(m), nil
}

// ListBusinessDomains 是 GET /api/v2/platform/business-domains 的只读 handler。
// 返回 `{list:[{code,name,description,enabled}], total}`（03_API_Standard §7.2）。
func ListBusinessDomains(store *BusinessDomainStore) gin.HandlerFunc {
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