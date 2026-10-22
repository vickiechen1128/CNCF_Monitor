package networkdomain

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
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
	// CenterEndpoint 中心接入地址（agent 可达）。边缘域（agent_pull 通道）的配置包下载
	// URL 优先使用该地址（与 agent 侧 CENTER_ENDPOINT 同源，中心地址变更时这是唯一需要
	// 同步更新的字段）；可选，非空时须为合法 http/https 地址（见 platform/edge/helpers.go）。
	CenterEndpoint string `json:"center_endpoint"`
}

// validDomainType reports whether dt is a domain type that may be provisioned
// through the registration API. Both edge (采集节点域) and management
// (中心直连域) domains are user-registered now; a management domain is a
// singleton with the fixed internal id "default".
func validDomainType(dt models.DomainType) bool {
	return dt == models.DomainTypeEdge || dt == models.DomainTypeManagement
}

// activeManagementDomainExists reports whether a non-deleted management domain
// already exists. The registration API allows at most one center-direct domain
// (the center Prometheus itself).
func activeManagementDomainExists(db *gorm.DB) (bool, error) {
	var n int64
	if err := db.Model(&models.NetworkDomain{}).
		Where("domain_type = ?", models.DomainTypeManagement).
		Count(&n).Error; err != nil {
		return false, fmt.Errorf("check management domain: %w", err)
	}
	return n > 0, nil
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

// Registration conflicts surfaced as 409 by the create handler.
var (
	errManagementDomainExists = errors.New("a center-direct management domain already exists")
	errDomainIDExists         = errors.New("network domain id already exists")
)

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

// CreateNetworkDomain registers a new network domain. Edge domains get an
// auto-generated id; the center-direct (management) domain is a singleton with
// the fixed internal id DefaultDomainID and can be re-registered after a soft
// delete (the same row is revived).
func CreateNetworkDomain(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateNetworkDomainRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid network domain payload: %w", err))
			return
		}
		if !validDomainType(req.DomainType) {
			response.BadRequest(c, fmt.Errorf("invalid domain_type %q: must be edge or management", req.DomainType))
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
		// 中心接入地址（可选）：非空时须为合法 http/https，保证能被解析为下载 URL
		// 的 authority（与 edge.resolveDownloadAuthority 口径一致）。
		if err := validateCenterEndpoint(req.CenterEndpoint); err != nil {
			response.BadRequest(c, err)
			return
		}
		isManagement := req.DomainType == models.DomainTypeManagement

		// 中心直连域使用固定内部 ID（default），不接受自定义 domain_code；
		// 采集节点域保持 `<deploy-code>-<domain-code>` 生成规则。
		var id string
		if isManagement {
			if req.DomainCode != "" && req.DomainCode != models.DefaultDomainID {
				response.BadRequest(c, fmt.Errorf("中心直连域使用固定内部标识 %q，不接受自定义 domain_code", models.DefaultDomainID))
				return
			}
			id = models.DefaultDomainID
		} else {
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
			generatedID, err := GenerateDomainID(ReadDeployCode(), domainCode)
			if err != nil {
				response.BadRequest(c, err)
				return
			}
			id = generatedID
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
			CenterEndpoint:      req.CenterEndpoint, // 边缘域下载 URL 来源（可选）
			// 通道由域类型派生（F-28 方案 A）：边缘域 agent_pull、中心直连域 local。
			Channel: models.ChannelForDomainType(req.DomainType),
			Status:  models.DomainStatusEnabled,
		}
		if isManagement {
			// 中心直连域由中心直接采集：创建即已纳管，无需再做 M09 纳管动作。
			domain.IsMonitored = true
			domain.RegistrationStatus = models.RegistrationStatusMonitored
		}

		// 事务原子保护（决策 103）：网域创建与授权租户同步必须同生共死。
		// 若 syncAuthorizedTenants 失败，整条登记回滚，避免产生"已建网域但无
		// 授权租户"的孤儿记录。syncAuthorizedTenants 接收 *gorm.DB 句柄，可直接
		// 传入事务句柄 tx。
		if err := db.Transaction(func(tx *gorm.DB) error {
			if isManagement {
				// 全平台只允许一个中心直连域。
				exists, aerr := activeManagementDomainExists(tx)
				if aerr != nil {
					return aerr
				}
				if exists {
					return errManagementDomainExists
				}

				// 删除后重建：复用软删的固定 ID 行，而不是撞主键返回 409。
				var existing models.NetworkDomain
				gerr := tx.Unscoped().Where("id = ?", id).First(&existing).Error
				switch {
				case gerr == nil:
					if !existing.DeletedAt.Valid {
						return errManagementDomainExists
					}
					// 用结构体 + Select 更新，确保 JSON serializer 字段（authorized_tenant_ids /
					// ip_cidrs）走与 Create 相同的序列化路径；deleted_at 置零即复活。
					existing.Name = domain.Name
					existing.Description = domain.Description
					existing.DomainType = domain.DomainType
					existing.ZoneType = domain.ZoneType
					existing.CloudCode = domain.CloudCode
					existing.TenantID = domain.TenantID
					existing.AuthorizedTenantIDs = domain.AuthorizedTenantIDs
					existing.IPCIDRs = domain.IPCIDRs
					existing.CenterEndpoint = domain.CenterEndpoint
					existing.Channel = domain.Channel
					existing.Status = domain.Status
					existing.IsMonitored = true
					existing.RegistrationStatus = models.RegistrationStatusMonitored
					// 中心直连域不使用采集节点：清空边缘运行态残留，避免重建后显示旧状态。
					existing.AgentType = ""
					existing.RemoteWriteURL = ""
					existing.MaxDiskUsagePerURL = ""
					existing.MonitoredStatus = ""
					existing.LastHeartbeat = nil
					existing.AgentVersion = ""
					existing.Token = ""
					existing.DeletedAt = gorm.DeletedAt{}
					if uerr := tx.Unscoped().Model(&existing).Select(
						"name", "description", "domain_type", "zone_type", "cloud_code",
						"tenant_id", "authorized_tenant_ids", "ip_cidrs", "center_endpoint",
						"channel", "status", "is_monitored", "registration_status",
						"agent_type", "remote_write_url", "max_disk_usage_per_url",
						"monitored_status", "last_heartbeat", "agent_version", "token",
						"deleted_at",
					).Updates(&existing).Error; uerr != nil {
						return uerr
					}
					return syncAuthorizedTenants(tx, id, domain.AuthorizedTenantIDs)
				case errors.Is(gerr, gorm.ErrRecordNotFound):
					// fall through to create
				default:
					return gerr
				}
			} else {
				var count int64
				// Unscoped 统计含软删记录：软删网域的 PK 在底层仍存在，db.Create 会触发
				// SQLite 主键唯一约束。删除后重登记同名 domain_code 应返回 409 而非 500。
				if dbErr := tx.Unscoped().Model(&models.NetworkDomain{}).Where("id = ?", id).Count(&count).Error; dbErr != nil {
					return fmt.Errorf("check domain id %q: %w", id, dbErr)
				}
				if count > 0 {
					return errDomainIDExists
				}
			}
			if cerr := tx.Create(domain).Error; cerr != nil {
				return cerr
			}
			return syncAuthorizedTenants(tx, id, domain.AuthorizedTenantIDs)
		}); err != nil {
			switch {
			case errors.Is(err, errManagementDomainExists):
				response.Conflict(c, fmt.Errorf("中心直连域已存在，全平台只能登记一个"))
				return
			case errors.Is(err, errDomainIDExists):
				response.Conflict(c, fmt.Errorf("network domain id %q already exists", id))
				return
			case isUniqueConstraintError(err):
				// 兜底：主键 / 单管理域唯一索引冲突映射为 409 而非 500。
				response.Conflict(c, fmt.Errorf("network domain %q already exists", id))
				return
			default:
				response.InternalServerError(c, fmt.Errorf("create network domain %q: %w", id, err))
				return
			}
		}

		// 重建场景（软删行复活）时把持久化后的字段读回来，保证响应与库一致。
		if err := db.Where("id = ?", id).First(domain).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("reload network domain %q: %w", id, err))
			return
		}
		response.OK(c, domain)
	}
}

// validateCenterEndpoint 校验中心接入地址（可选）：非空时必须 scheme ∈ {http,https}
// 且 host 非空，与 edge.resolveDownloadAuthority 的解析口径一致，保证该字段一旦登记即能
// 被可靠解析为下载 URL 的 authority（避免 agent 拉包回连失败 / 生成缺 scheme 的相对地址）。
func validateCenterEndpoint(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("center_endpoint 格式不正确：%q", raw)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("center_endpoint 的 scheme 必须是 http/https，当前：%q", u.Scheme)
	}
	if u.Host == "" {
		return fmt.Errorf("center_endpoint 缺少主机：%q", raw)
	}
	return nil
}
