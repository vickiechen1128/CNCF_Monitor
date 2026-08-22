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
	ZoneType            string            `json:"zone_type"`
	Description         string            `json:"description"`
	DomainCode          string            `json:"domain_code"`
	AuthorizedTenantIDs []string          `json:"authorized_tenant_ids"`
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
			TenantID:            tenantID,
			AuthorizedTenantIDs: auth,
			Channel:             models.ChannelTypeLocal,
			Status:              models.DomainStatusEnabled,
		}
		if err := db.Create(domain).Error; err != nil {
			// 兜底：主键唯一约束冲突（如软删记录 PK 残留）映射为 409 而非 500。
			if isUniqueConstraintError(err) {
				response.Conflict(c, fmt.Errorf("network domain id %q already exists", id))
				return
			}
			response.InternalServerError(c, fmt.Errorf("create network domain %q: %w", id, err))
			return
		}
		if err := syncAuthorizedTenants(db, id, domain.AuthorizedTenantIDs); err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, domain)
	}
}
