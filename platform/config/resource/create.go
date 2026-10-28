// create.go 提供资源创建接口（POST /api/v2/platform/resources，T07-06）：
// 服务端生成 resource_id（uuid，创建后不可变，PRD §5.2）、source_type=manual、
// tenant_id 缺省 platform_admin；复用 T07-03 ValidateResourceInput 完成字段/
// 网域/biz 校验；落库经 LegacyFieldMap 语义映射规范字段到模型列（如 host:
// instance_ip→private_ip、os_type→image、env→env_flag、cluster→sub_app_code、
// app_name→app_code）。
package resource

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

// networkDomainExistsFunc 构造 networkDomainExists 注入函数：以 M06 行政记录
// （NetworkDomain 表，软删不计）为准校验 network_domain_id 存在性（§5.4）。
// 中心直连域不再预置，因此 default 也必须是真实存在的登记行，不能无条件放行。
func networkDomainExistsFunc(db *gorm.DB) func(string) bool {
	return func(id string) bool {
		id = strings.TrimSpace(id)
		var count int64
		if err := db.Model(&models.NetworkDomain{}).Where("id = ?", id).Count(&count).Error; err != nil {
			return false
		}
		return count > 0
	}
}

// newResourceID 生成 uuid v4 字符串（crypto/rand，无外部依赖；PRD §5.2
// resource_id 由服务端生成，创建后不可变）。
func newResourceID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("生成 resource_id 失败：%w", err)
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%s-%s-%s-%s-%s",
		hex.EncodeToString(b[0:4]),
		hex.EncodeToString(b[4:6]),
		hex.EncodeToString(b[6:8]),
		hex.EncodeToString(b[8:10]),
		hex.EncodeToString(b[10:16]),
	), nil
}

// newTypedModel 构造某类型资源的空模型并预置创建契约字段：resource_id（uuid）、
// resource_category、source_type=manual（创建接口固定）、tenant_id=platform_admin。
// Host 的 ServerID 同步为 resource_id：其 legacy 唯一索引要求非空且唯一。
func newTypedModel(category models.ResourceCategory, resourceID string) (any, error) {
	switch category {
	case models.ResourceCategoryHost:
		return &models.Host{
			ResourceID:       resourceID,
			ServerID:         resourceID,
			ResourceCategory: category,
			SourceType:       models.SourceTypeManual,
			TenantID:         models.PlatformAdminTenantID,
		}, nil
	case models.ResourceCategoryDatabase:
		return &models.Database{
			ResourceBase: models.ResourceBase{
				ResourceID:       resourceID,
				ResourceCategory: category,
				SourceType:       models.SourceTypeManual,
				TenantID:         models.PlatformAdminTenantID,
			},
			ResourceType: models.ResourceTypeDatabase,
		}, nil
	case models.ResourceCategoryMiddleware:
		return &models.Middleware{
			ResourceID:       resourceID,
			ResourceType:     models.ResourceTypeMiddleware,
			ResourceCategory: category,
			SourceType:       models.SourceTypeManual,
			TenantID:         models.PlatformAdminTenantID,
		}, nil
	case models.ResourceCategoryApplication:
		return &models.Application{
			ResourceID:       resourceID,
			ResourceType:     models.ResourceTypeApplication,
			ResourceCategory: category,
			SourceType:       models.SourceTypeManual,
			TenantID:         models.PlatformAdminTenantID,
		}, nil
	case models.ResourceCategoryGenericTarget:
		return &models.GenericTarget{
			ResourceBase: models.ResourceBase{
				ResourceID:       resourceID,
				ResourceCategory: category,
				SourceType:       models.SourceTypeManual,
				TenantID:         models.PlatformAdminTenantID,
			},
			ResourceType: models.ResourceTypeGenericTarget,
		}, nil
	case models.ResourceCategoryInterfaceService:
		return &models.InterfaceService{
			ResourceBase: models.ResourceBase{
				ResourceID:       resourceID,
				ResourceCategory: category,
				SourceType:       models.SourceTypeManual,
				TenantID:         models.PlatformAdminTenantID,
			},
			ResourceType: models.ResourceTypeInterfaceService,
		}, nil
	}
	return nil, fmt.Errorf("unsupported resource_category: %s", category)
}

// buildResourceModel 由输入构造完整资源模型：生成 uuid 并预置创建契约字段后，
// 应用输入字段（含 legacy 映射），供创建落库与测试复用。
func buildResourceModel(category models.ResourceCategory, in *ResourceInput) (any, error) {
	resourceID, err := newResourceID()
	if err != nil {
		return nil, err
	}
	model, err := newTypedModel(category, resourceID)
	if err != nil {
		return nil, err
	}
	applyInputToModel(category, model, in)
	return model, nil
}

// applyInputToModel 将 ResourceInput 应用到已构造/已加载的具体资源模型的可更新
// 字段上。创建与更新共用：创建时模型为 newTypedModel 空壳，更新时模型为已加载行
// （未提供的可空字段保留原值，如 host 的 instance_name 仅在有输入时才覆盖）。
func applyInputToModel(category models.ResourceCategory, model any, in *ResourceInput) {
	switch m := model.(type) {
	case *models.Host:
		applyHostInput(m, in)
	case *models.Database:
		applyDatabaseInput(m, in)
	case *models.Middleware:
		applyMiddlewareInput(m, in)
	case *models.Application:
		applyApplicationInput(m, in)
	case *models.GenericTarget:
		applyGenericTargetInput(m, in)
	case *models.InterfaceService:
		applyInterfaceServiceInput(m, in)
	}
}

// strPtr 将字符串转 *string（空串返回 nil），供 Database/GenericTarget 的
// ResourceBase.AppName/Cluster（可空 *string 列）使用。
func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// applyHostInput 将输入映射到 Host 模型列（legacy 映射见 LegacyFieldMap：
// instance_ip→private_ip、os_type→image、env→env_flag、cluster→sub_app_code、
// app_name→app_code；hostname 默认与 instance_name 一致，§5.2）。
// Host 模型无 owner 列，owner 不落库（§5.6）。
func applyHostInput(h *models.Host, in *ResourceInput) {
	h.NetworkDomainID = in.NetworkDomainID
	h.BizCode = in.BizCode
	h.AppCode = in.AppCode           // 决策 92：资源侧只存不可变编码 app_code
	h.PlatformCode = in.PlatformCode // 决策 110：资源行一等字段（可空，留空走应用主平台兜底）
	h.SubAppCode = in.Cluster
	h.EnvFlag = in.Env
	h.Status = in.Status
	if in.InstanceName != "" {
		h.InstanceName = in.InstanceName
	} else if in.Hostname != "" {
		h.InstanceName = in.Hostname
	}
	h.PrivateIP = in.InstanceIP
	// os_type 经内置 OS 字典归一化为规范名（models.NormalizeOSType），
	// 保证采集 Job host_linux/host_windows 候选按家族稳定命中（os_dict.go）。
	h.Image = models.NormalizeOSType(in.OSType)
	h.ScrapePort = in.ScrapePort // 实例级采集端口覆盖（0=未指定）
}

func applyDatabaseInput(d *models.Database, in *ResourceInput) {
	d.NetworkDomainID = in.NetworkDomainID
	d.BizCode = in.BizCode
	d.AppName = strPtr(in.AppCode)   // 决策 92：AppName 物理列语义切换为 app_code 编码
	d.PlatformCode = in.PlatformCode // 决策 110
	d.Cluster = strPtr(in.Cluster)
	d.Env = in.Env
	d.Owner = in.Owner
	d.Status = in.Status
	d.DatabaseType = in.DatabaseType
	d.InstanceIP = in.InstanceIP
	d.Port = in.Port
	d.Version = in.Version
	d.ScrapePort = in.ScrapePort // 实例级采集端口覆盖（0=未指定）
}

func applyMiddlewareInput(m *models.Middleware, in *ResourceInput) {
	m.NetworkDomainID = in.NetworkDomainID
	m.BizCode = in.BizCode
	m.AppName = in.AppCode           // 决策 92：AppName 物理列语义切换为 app_code 编码
	m.PlatformCode = in.PlatformCode // 决策 110
	m.Cluster = in.Cluster
	m.Env = in.Env
	m.Owner = in.Owner
	m.Status = in.Status
	m.MiddlewareType = in.MiddlewareType
	m.InstanceIP = in.InstanceIP
	m.Port = in.Port
	m.Version = in.Version
	m.ScrapePort = in.ScrapePort // 实例级采集端口覆盖（0=未指定）
}

func applyApplicationInput(a *models.Application, in *ResourceInput) {
	a.NetworkDomainID = in.NetworkDomainID
	a.BizCode = in.BizCode
	a.AppName = in.AppCode           // 决策 92：AppName 物理列语义切换为 app_code 编码
	a.PlatformCode = in.PlatformCode // 决策 110
	a.Cluster = in.Cluster
	a.Env = in.Env
	a.Owner = in.Owner
	a.Owner1 = in.Owner1
	a.Owner1Contact = in.Owner1Contact
	a.Owner2 = in.Owner2
	a.Owner2Contact = in.Owner2Contact
	a.GoLiveAt, _ = parseGoLiveAt(in.GoLiveAt)
	a.Status = in.Status
	a.ServiceName = in.ServiceName
	a.HealthCheckURL = in.HealthCheckURL
	a.Protocol = in.Protocol
	a.Endpoint = in.Endpoint
	a.Port = in.Port
	a.ScrapePort = in.ScrapePort // 实例级采集端口覆盖（0=未指定）
}

func applyGenericTargetInput(g *models.GenericTarget, in *ResourceInput) {
	g.NetworkDomainID = in.NetworkDomainID
	g.BizCode = in.BizCode
	g.AppName = strPtr(in.AppCode)   // 决策 92：AppName 物理列语义切换为 app_code 编码
	g.PlatformCode = in.PlatformCode // 决策 110
	g.Cluster = strPtr(in.Cluster)
	g.Env = in.Env
	g.Owner = in.Owner
	g.Status = in.Status
	g.TargetName = in.TargetName
	g.InstanceIP = in.InstanceIP
	g.Port = in.Port
	g.MetricsPath = in.MetricsPath
	g.Scheme = in.Scheme
	g.ExporterType = in.ExporterType
	g.CustomLabels = in.CustomLabels
	g.ScrapePort = in.ScrapePort // 实例级采集端口覆盖（0=未指定）
}

// applyInterfaceServiceInput 将输入映射到 InterfaceService 模型列（第 6 类资源）。
// 处理方式与 applyGenericTargetInput 一致：app_code 经 strPtr 写入 ResourceBase.AppName
// （物理列 app_name，可空 *string）、cluster 经 strPtr 写入 ResourceBase.Cluster。
// 类型专属字段为 APIName / APIURL。scrape_port 等未暴露列保留模型默认值。
func applyInterfaceServiceInput(o *models.InterfaceService, in *ResourceInput) {
	o.NetworkDomainID = in.NetworkDomainID
	o.BizCode = in.BizCode
	o.AppName = strPtr(in.AppCode)   // 决策 92：AppName 物理列语义切换为 app_code 编码
	o.PlatformCode = in.PlatformCode // 决策 110
	o.Cluster = strPtr(in.Cluster)
	o.Env = in.Env
	o.Owner = in.Owner
	o.Status = in.Status
	o.APIName = in.APIName
	o.APIURL = in.APIURL
	o.ScrapePort = in.ScrapePort // 实例级采集端口覆盖（0=未指定）
}

// CreateResource 是 POST /api/v2/platform/resources 的创建 handler。
//
// 请求体为 ResourceInput（§5.2 规范字段名 + 差异化字段）。流程：
//  1. resource_category 必填且合法（缺失/非法 → bad_request）；
//  2. 网域存在性 + biz_code 存在且启用 + app_code（若填）须对应启用应用字典
//     + platform_code（若填）须为启用平台且与该应用关联平台集合自洽
//     + 字段/枚举/格式校验（T07-03 ValidateResourceInputWithPlatform，失败返回含
//     字段名错误 → bad_request，决策 92：app_code 只允许引用未停用条目）；
//  3. resource_id 服务端生成 uuid；source_type=manual（创建接口固定，
//     服务端权威，不接受客户端覆盖）；tenant_id 缺省 platform_admin；
//  4. 经 LegacyFieldMap 语义落库（create.go 各 apply*Input）；
//  5. 成功返回创建后的完整对象（复用 T07-05 buildListItem）。
//
// 本文件只实现 handler，不注册路由（路由收口见 T07-18）。
func CreateResource(db *gorm.DB, bizStore *BusinessDomainStore, appStore *ApplicationDictStore, platformStore *PlatformDictStore, appPlatformStore *AppPlatformStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		var in ResourceInput
		if err := c.ShouldBindJSON(&in); err != nil {
			response.BadRequest(c, fmt.Errorf("请求体解析失败：%w", err))
			return
		}
		category := models.ResourceCategory(strings.TrimSpace(in.ResourceCategory))
		if !isValidCategory(category) {
			response.BadRequest(c, fmt.Errorf("resource_category 非法：%q，可选 %s", in.ResourceCategory, models.CategoriesHint()))
			return
		}
		platform := &PlatformRefs{PlatformStore: platformStore, AppPlatformStore: appPlatformStore}
		if err := ValidateResourceInputWithPlatform(category, &in, bizStore, appStore, networkDomainExistsFunc(db), platform); err != nil {
			response.BadRequest(c, err)
			return
		}

		model, err := buildResourceModel(category, &in)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if err := db.Create(model).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("创建 %s 资源失败：%w", category, err))
			return
		}
		response.OK(c, buildListItem(model, category))
	}
}
