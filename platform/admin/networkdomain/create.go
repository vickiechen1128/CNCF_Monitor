package networkdomain

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// CreateNetworkDomainRequest is the body for registering a network domain.
// The client never supplies tenant_id: registration ownership is fixed to the
// platform admin tenant (not trusted from the client). domain_code is optional;
// when omitted the backend auto-generates a unique code so the id can still be
// produced as `<deploy_code>-<domain_code>`.
type CreateNetworkDomainRequest struct {
	Name                string            `json:"name" binding:"required"`
	DomainType          models.DomainType `json:"domain_type" binding:"required"`
	ZoneType            string            `json:"zone_type" binding:"required"` // 部署级 zone_type 字典取值（必填，不可自由文本，M06 §5.2）
	CloudCode           string            `json:"cloud_code" binding:"required"` // 决策 103 scheme-B：登记必填，须引用已启用云字典条目
	Description         string            `json:"description"`
	DomainCode          string            `json:"domain_code"`
	AuthorizedTenantIDs []string          `json:"authorized_tenant_ids"`
	IPCIDRs             []string          `json:"ip_cidrs"` // 网段（可选），资源导入时按 IP 自动推导网域归属
}

// validDomainType reports whether dt is a domain type that may be provisioned
// through the registration API. Management domains are system-provisioned
// (only the platform admin) and must NOT be created via business registration,
// so the API only accepts edge domains here.
func validDomainType(dt models.DomainType) bool {
	return dt == models.DomainTypeEdge
}

// randomDomainCode returns a short random lowercase-hex domain code used when
// the client does not provide one.
func randomDomainCode() (string, error) {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate random domain code: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// isUniqueConstraintError reports whether err is a SQLite UNIQUE constraint
// violation, which we map to HTTP 409 for re-registering a soft-deleted id.
func isUniqueConstraintError(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint")
}

// validateCloudCodeEnabled 校验 cloud_code 必须引用「已启用」的部署级云字典条目
// （决策 103 scheme-B：cloud 标签权威来源）。字典加载失败即报错，不允许在字典不可用时
// 放行登记。
func validateCloudCodeEnabled(db *gorm.DB, code string) error {
	code = strings.TrimSpace(code)
	if code == "" {
		return fmt.Errorf("cloud_code 必填（须为云字典启用条目）")
	}
	var count int64
	if err := db.Model(&models.CloudDict{}).Where("cloud_code = ? AND enabled = ?", code, true).Count(&count).Error; err != nil {
		return fmt.Errorf("云字典加载失败：%w", err)
	}
	if count == 0 {
		return fmt.Errorf("云 %s 未登记或已停用，请联系平台管理员在云字典中启用后重试", code)
	}
	return nil
}

// validateNetworkDomainZoneType 校验 zone_type 必填且为部署级 zone_type 字典取值
// （不可自由文本，M06 §5.2）。字典加载失败即报错，不放行。
func validateNetworkDomainZoneType(db *gorm.DB, zt string) error {
	zt = strings.TrimSpace(zt)
	if zt == "" {
		return fmt.Errorf("zone_type 必填（须为部署级 zone_type 字典取值）")
	}
	var count int64
	if err := db.Model(&models.ZoneType{}).Where("code = ?", zt).Count(&count).Error; err != nil {
		return fmt.Errorf("zone_type 字典加载失败：%w", err)
	}
	if count == 0 {
		return fmt.Errorf("zone_type %q 非法（须为部署级 zone_type 字典取值）", zt)
	}
	return nil
}

// nameExists reports whether another non-deleted network domain already uses the
// given name. excludeID lets update skip the domain being edited. Names are
// compared case-insensitively (SQLite stores them as-is; lower() folds ASCII).
func nameExists(db *gorm.DB, name, excludeID string) (bool, error) {
	q := db.Model(&models.NetworkDomain{}).Where("lower(name) = lower(?)", name)
	if excludeID != "" {
		q = q.Where("id <> ?", excludeID)
	}
	var count int64
	if err := q.Count(&count).Error; err != nil {
		return false, fmt.Errorf("check network domain name %q: %w", name, err)
	}
	return count > 0, nil
}

// CreateNetworkDomain registers a new network domain with an auto-generated id.
func CreateNetworkDomain(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateNetworkDomainRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid network domain payload: %w", err))
			return
		}
		if !validDomainType(req.DomainType) {
			response.BadRequest(c, fmt.Errorf("invalid domain_type %q: only edge domains can be registered; management domains are system-provisioned", req.DomainType))
			return
		}
		// 决策 103 scheme-B：zone_type 必填且须为部署级 zone_type 字典取值（不可自由文本）。
		if err := validateNetworkDomainZoneType(db, req.ZoneType); err != nil {
			response.BadRequest(c, err)
			return
		}
		// 决策 103 scheme-B：cloud_code 必填且须引用已启用云字典条目；字典加载失败即报错，不放行。
		if err := validateCloudCodeEnabled(db, req.CloudCode); err != nil {
			response.BadRequest(c, err)
			return
		}
		if req.DomainCode == models.DefaultDomainID {
			response.BadRequest(c, fmt.Errorf("domain code %q is reserved", models.DefaultDomainID))
			return
		}

		domainCode := req.DomainCode
		if domainCode == "" {
			generated, err := randomDomainCode()
			if err != nil {
				response.InternalServerError(c, err)
				return
			}
			domainCode = generated
		}

		id, err := GenerateDomainID(ReadDeployCode(), domainCode)
		if err != nil {
			response.BadRequest(c, err)
			return
		}

		var count int64
		// Unscoped 统计含软删记录：软删网域的 PK 在底层仍存在，db.Create 会触发
		// SQLite 主键唯一约束。删除后重登记同名 domain_code 应返回 409 而非 500。
		if dbErr := db.Unscoped().Model(&models.NetworkDomain{}).Where("id = ?", id).Count(&count).Error; dbErr != nil {
			response.InternalServerError(c, fmt.Errorf("check domain id %q: %w", id, dbErr))
			return
		}
		if count > 0 {
			response.Conflict(c, fmt.Errorf("network domain id %q already exists", id))
			return
		}

		// 网域名称唯一性校验：同名（大小写不敏感）禁止重复登记。
		if dup, err := nameExists(db, req.Name, ""); err != nil {
			response.InternalServerError(c, err)
			return
		} else if dup {
			response.Conflict(c, fmt.Errorf("network domain name %q already exists", req.Name))
			return
		}

		tenantID := models.PlatformAdminTenantID
		auth := req.AuthorizedTenantIDs
		if len(auth) == 0 {
			auth = []string{tenantID} // 缺省 = 登记归属租户
		}

		domain := &models.NetworkDomain{
			ID:                  id,
			Name:                req.Name,
			Description:         req.Description,
			DomainType:          req.DomainType,
			ZoneType:            req.ZoneType,
			CloudCode:           req.CloudCode,
			TenantID:            tenantID,
			AuthorizedTenantIDs: auth,
			IPCIDRs:             req.IPCIDRs,
			// 通道由域类型派生（F-28 方案 A）：本接口只登记边缘域，故恒为 agent_pull。
			// 早期版本无条件写 local，会让未纳管边缘域被误判为 local 通道。
			Channel: models.ChannelForDomainType(req.DomainType),
			Status:  models.DomainStatusEnabled,
		}
		// 事务原子保护（决策 103）：网域创建与授权租户同步必须同生共死。
		// 若 syncAuthorizedTenants 失败，整条登记回滚，避免产生"已建网域但无
		// 授权租户"的孤儿记录。syncAuthorizedTenants 接收 *gorm.DB 句柄，可直接
		// 传入事务句柄 tx。
		if err := db.Transaction(func(tx *gorm.DB) error {
			if cerr := tx.Create(domain).Error; cerr != nil {
				return cerr
			}
			return syncAuthorizedTenants(tx, id, domain.AuthorizedTenantIDs)
		}); err != nil {
			// 兜底：主键唯一约束冲突（如软删记录 PK 残留）映射为 409 而非 500。
			if isUniqueConstraintError(err) {
				response.Conflict(c, fmt.Errorf("network domain id %q already exists", id))
				return
			}
			response.InternalServerError(c, fmt.Errorf("create network domain %q: %w", id, err))
			return
		}
		response.OK(c, domain)
	}
}
