package resource

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

var (
	ErrAppPlatformRelExists   = errors.New("应用与平台关联已存在")
	ErrAppPlatformRelNotFound = errors.New("应用与平台关联不存在")
)

// AppPlatformRel 是应用↔平台关联的 API 视图。
type AppPlatformRel struct {
	RelID        uint      `json:"rel_id"`
	AppCode      string    `json:"app_code"`
	PlatformCode string    `json:"platform_code"`
	IsPrimary    bool      `json:"is_primary"`
	CreatedAt    time.Time `json:"created_at"`
}

// AppPlatformStore 提供 app_platform_rel 的事务化读写。
type AppPlatformStore struct {
	db *gorm.DB
}

func NewAppPlatformStore(db *gorm.DB) *AppPlatformStore {
	return &AppPlatformStore{db: db}
}

func toAppPlatformRel(m models.AppPlatformRel) AppPlatformRel {
	return AppPlatformRel{
		RelID:        m.ID,
		AppCode:      m.AppCode,
		PlatformCode: m.PlatformCode,
		IsPrimary:    m.IsPrimary,
		CreatedAt:    m.CreatedAt,
	}
}

func (s *AppPlatformStore) List(appCode, platformCode string) ([]AppPlatformRel, error) {
	query := s.db.Model(&models.AppPlatformRel{})
	if appCode != "" {
		query = query.Where("app_code = ?", appCode)
	}
	if platformCode != "" {
		query = query.Where("platform_code = ?", platformCode)
	}

	var rows []models.AppPlatformRel
	if err := query.Order("id ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("查询应用平台关联：%w", err)
	}
	out := make([]AppPlatformRel, 0, len(rows))
	for _, row := range rows {
		out = append(out, toAppPlatformRel(row))
	}
	return out, nil
}

// PlatformCodesOf 返回某应用已关联的平台编码集合（按 id 稳定排序），供资源行
// platform_code 与所属应用平台集合的自洽校验消费（决策 110）。store 未初始化或
// 应用无关联时返回空切片（调用方据此跳过自洽校验）。
func (s *AppPlatformStore) PlatformCodesOf(appCode string) ([]string, error) {
	if s == nil || s.db == nil {
		return nil, nil
	}
	var codes []string
	if err := s.db.Model(&models.AppPlatformRel{}).
		Where("app_code = ?", appCode).
		Order("id ASC").
		Pluck("platform_code", &codes).Error; err != nil {
		return nil, fmt.Errorf("查询应用 %s 关联平台：%w", appCode, err)
	}
	return codes, nil
}

// PrimaryPlatformOf 返回某应用的主平台编码（is_primary=true）；无主平台时返回空串
// 与 false。供资源行 platform_code 留空时的兜底取值消费（决策 110）。
func (s *AppPlatformStore) PrimaryPlatformOf(appCode string) (string, bool, error) {
	if s == nil || s.db == nil {
		return "", false, nil
	}
	var code string
	err := s.db.Model(&models.AppPlatformRel{}).
		Where("app_code = ? AND is_primary = ?", appCode, true).
		Order("id ASC").
		Limit(1).
		Pluck("platform_code", &code).Error
	if err != nil {
		return "", false, fmt.Errorf("查询应用 %s 主平台：%w", appCode, err)
	}
	if code == "" {
		return "", false, nil
	}
	return code, true, nil
}

func (s *AppPlatformStore) Create(rel models.AppPlatformRel) (AppPlatformRel, error) {
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&models.AppPlatformRel{}).
			Where("app_code = ? AND platform_code = ?", rel.AppCode, rel.PlatformCode).
			Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrAppPlatformRelExists
		}
		if rel.IsPrimary {
			if err := models.ValidateAppPlatformPrimaryUnique(tx, rel.AppCode, 0); err != nil {
				return err
			}
		}
		return tx.Create(&rel).Error
	})
	if err != nil {
		return AppPlatformRel{}, err
	}
	return toAppPlatformRel(rel), nil
}

// SetPrimary 仅切换 is_primary；置 true 时在同一事务内先清除同应用其余主平台，
// 再把当前关联设为主平台。
func (s *AppPlatformStore) SetPrimary(relID uint, isPrimary bool) (AppPlatformRel, error) {
	var rel models.AppPlatformRel
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&rel, relID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrAppPlatformRelNotFound
			}
			return err
		}
		if isPrimary {
			if err := tx.Model(&models.AppPlatformRel{}).
				Where("app_code = ? AND id <> ?", rel.AppCode, rel.ID).
				Update("is_primary", false).Error; err != nil {
				return err
			}
			if err := models.ValidateAppPlatformPrimaryUnique(tx, rel.AppCode, rel.ID); err != nil {
				return err
			}
		}
		if err := tx.Model(&rel).Update("is_primary", isPrimary).Error; err != nil {
			return err
		}
		rel.IsPrimary = isPrimary
		return nil
	})
	if err != nil {
		return AppPlatformRel{}, err
	}
	return toAppPlatformRel(rel), nil
}

func (s *AppPlatformStore) Delete(relID uint) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		var rel models.AppPlatformRel
		if err := tx.First(&rel, relID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrAppPlatformRelNotFound
			}
			return err
		}
		return tx.Unscoped().Delete(&rel).Error
	})
}

type CreateAppPlatformRelRequest struct {
	AppCode      string `json:"app_code"`
	PlatformCode string `json:"platform_code"`
	IsPrimary    bool   `json:"is_primary"`
}

type UpdateAppPlatformRelRequest struct {
	IsPrimary *bool `json:"is_primary"`
}

func validateAppPlatformRefs(appStore *ApplicationDictStore, platformStore *PlatformDictStore, appCode, platformCode string) error {
	app, found, err := appStore.Lookup(appCode)
	if err != nil {
		return fmt.Errorf("应用字典加载失败：%w", err)
	}
	if !found || app.Status != models.AppStatusEnabled {
		return fmt.Errorf("应用 %s 未登记或已停用，请到『应用字典』登记或启用后重试", appCode)
	}

	platform, found, err := platformStore.Lookup(platformCode)
	if err != nil {
		return fmt.Errorf("平台字典加载失败：%w", err)
	}
	if !found || !platform.Enabled {
		return fmt.Errorf("平台 %s 未登记或已停用，请到『平台字典』登记或启用后重试", platformCode)
	}
	return nil
}

func parseAppPlatformRelID(c *gin.Context) (uint, bool) {
	raw := strings.TrimSpace(c.Param("rel_id"))
	id, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || id == 0 {
		response.BadRequest(c, fmt.Errorf("rel_id 必须为正整数"))
		return 0, false
	}
	return uint(id), true
}

// ListAppPlatformRels 是 GET /api/v2/platform/app-platform-rel。
func ListAppPlatformRels(store *AppPlatformStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		list, err := store.List(strings.TrimSpace(c.Query("app_code")), strings.TrimSpace(c.Query("platform_code")))
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, gin.H{"list": list, "total": len(list)})
	}
}

// CreateAppPlatformRel 是 POST /api/v2/platform/app-platform-rel。
func CreateAppPlatformRel(store *AppPlatformStore, appStore *ApplicationDictStore, platformStore *PlatformDictStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateAppPlatformRelRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("请求体解析失败：%w", err))
			return
		}
		req.AppCode = strings.TrimSpace(req.AppCode)
		req.PlatformCode = strings.TrimSpace(req.PlatformCode)
		if req.AppCode == "" || req.PlatformCode == "" {
			response.BadRequest(c, fmt.Errorf("app_code 和 platform_code 必填"))
			return
		}
		if err := validateAppPlatformRefs(appStore, platformStore, req.AppCode, req.PlatformCode); err != nil {
			response.BadRequest(c, err)
			return
		}
		created, err := store.Create(models.AppPlatformRel{
			AppCode:      req.AppCode,
			PlatformCode: req.PlatformCode,
			IsPrimary:    req.IsPrimary,
		})
		if err != nil {
			switch {
			case errors.Is(err, ErrAppPlatformRelExists):
				response.BadRequest(c, fmt.Errorf("应用 %s 与平台 %s 已关联", req.AppCode, req.PlatformCode))
			case errors.Is(err, models.ErrPrimaryPlatformExists):
				response.BadRequest(c, fmt.Errorf("应用 %s 已存在主平台", req.AppCode))
			default:
				response.InternalServerError(c, fmt.Errorf("创建应用平台关联：%w", err))
			}
			return
		}
		response.OK(c, created)
	}
}

// UpdateAppPlatformRel 是 PUT /api/v2/platform/app-platform-rel/:rel_id。
func UpdateAppPlatformRel(store *AppPlatformStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		relID, ok := parseAppPlatformRelID(c)
		if !ok {
			return
		}
		var req UpdateAppPlatformRelRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("请求体解析失败：%w", err))
			return
		}
		if req.IsPrimary == nil {
			response.BadRequest(c, fmt.Errorf("is_primary 必填"))
			return
		}
		updated, err := store.SetPrimary(relID, *req.IsPrimary)
		if err != nil {
			if errors.Is(err, ErrAppPlatformRelNotFound) {
				response.NotFound(c, fmt.Sprintf("应用平台关联 %d 不存在", relID))
			} else {
				response.InternalServerError(c, fmt.Errorf("更新应用平台关联：%w", err))
			}
			return
		}
		response.OK(c, updated)
	}
}

// DeleteAppPlatformRel 是 DELETE /api/v2/platform/app-platform-rel/:rel_id。
func DeleteAppPlatformRel(store *AppPlatformStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		relID, ok := parseAppPlatformRelID(c)
		if !ok {
			return
		}
		if err := store.Delete(relID); err != nil {
			if errors.Is(err, ErrAppPlatformRelNotFound) {
				response.NotFound(c, fmt.Sprintf("应用平台关联 %d 不存在", relID))
			} else {
				response.InternalServerError(c, fmt.Errorf("删除应用平台关联：%w", err))
			}
			return
		}
		response.OK(c, gin.H{"rel_id": relID, "warnings": []string{}})
	}
}
