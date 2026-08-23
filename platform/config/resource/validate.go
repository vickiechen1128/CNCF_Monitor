package resource

import (
	"fmt"
	"net"
	"net/url"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
)

// validStatuses 是 Resource.status 的合法枚举（API 写请求不接受中文状态，
// 中文状态仅 Excel 导入经状态映射字典转换后进入，见 Module_07 §5.16.2）。
var validStatuses = map[models.ResourceStatus]struct{}{
	models.ResourceStatusOnline:      {},
	models.ResourceStatusOffline:     {},
	models.ResourceStatusMaintenance: {},
}

// ResourceInput 是五类资源写请求/导入行的统一输入视图，字段名遵循 PRD
// §5.2/§5.6~§5.9 规范字段名（host 的 instance_ip/hostname/os_type 等 legacy
// 映射见 LegacyFieldMap，供 T07-05/06 落库复用）。
type ResourceInput struct {
	ResourceCategory string `json:"resource_category"`
	NetworkDomainID  string `json:"network_domain_id"`
	BizCode          string `json:"biz_code"`
	AppName          string `json:"app_name"`
	Cluster          string `json:"cluster"`
	Owner            string `json:"owner"`
	Status           string `json:"status"`
	Env              string `json:"env"`
	SourceType       string `json:"source_type"`

	// host（§5.6）
	InstanceName string `json:"instance_name"` // 展示名；host 模板必填，生成 hostname label
	InstanceIP   string `json:"instance_ip"`
	OSType       string `json:"os_type"`
	Hostname     string `json:"hostname"`

	// database / middleware（§5.7 / §5.7.1）
	DatabaseType   string `json:"database_type"`
	MiddlewareType string `json:"middleware_type"`
	Port           int    `json:"port"`
	Version        string `json:"version"`

	// application（§5.8）
	ServiceName    string `json:"service_name"`
	HealthCheckURL string `json:"health_check_url"`
	Protocol       string `json:"protocol"`
	Endpoint       string `json:"endpoint"`

	// generic_target（§5.9）
	TargetName   string            `json:"target_name"`
	MetricsPath  string            `json:"metrics_path"`
	Scheme       string            `json:"scheme"`
	ExporterType string            `json:"exporter_type"`
	CustomLabels map[string]string `json:"custom_labels"`
}

// ValidateResourceInput 校验资源写请求/导入行输入（纯函数，外部副作用仅来自注入的
// bizStore 与 networkDomainExists）：
//
//   - 必填项：按类型差异化（host/generic_target 的 app_name/cluster 可空，
//     application/database/middleware 必填，§5.2 ✅*）；
//   - 枚举：env∈ValidEnvs、protocol∈ValidProtocols、scheme∈ValidSchemes、
//     status 仅 online/offline/maintenance（不接受中文状态）；
//   - 格式：instance_ip IPv4（generic_target 另允许域名）、port 1~65535、
//     health_check_url 为合法 HTTP/TCP URL；
//   - 存在性：biz_code 必填且对应已启用业务字典条目（§3.1）；network_domain_id
//     经 networkDomainExists 校验（M06 行政记录，default 例外由调用方决定）。
//
// 校验失败返回含字段名的错误，供 handler 包装为 bad_request（§6.6.1）。
func ValidateResourceInput(category models.ResourceCategory, in *ResourceInput, bizStore *BusinessDomainStore, networkDomainExists func(string) bool) error {
	if in == nil {
		return fmt.Errorf("resource input 不能为空")
	}
	if !isValidCategory(category) {
		return fmt.Errorf("resource_category 非法：%s", category)
	}
	if err := validateCommon(in, bizStore, networkDomainExists); err != nil {
		return err
	}
	switch category {
	case models.ResourceCategoryHost:
		return validateHost(in)
	case models.ResourceCategoryDatabase:
		return validateDatabase(in)
	case models.ResourceCategoryMiddleware:
		return validateMiddleware(in)
	case models.ResourceCategoryApplication:
		return validateApplication(in)
	case models.ResourceCategoryGenericTarget:
		return validateGenericTarget(in)
	}
	return nil
}

// validateCommon 校验五类共享字段：网域存在性、biz_code 存在且启用、env/status 枚举。
func validateCommon(in *ResourceInput, bizStore *BusinessDomainStore, networkDomainExists func(string) bool) error {
	if strings.TrimSpace(in.NetworkDomainID) == "" {
		return fmt.Errorf("network_domain_id 必填")
	}
	if networkDomainExists != nil && !networkDomainExists(in.NetworkDomainID) {
		return fmt.Errorf("网域 %s 未登记，请先到『系统设置 → 网域管理』登记后重试", in.NetworkDomainID)
	}
	if strings.TrimSpace(in.BizCode) == "" {
		return fmt.Errorf("biz_code 必填")
	}
	if !models.ValidBizCode.MatchString(in.BizCode) {
		return fmt.Errorf("biz_code 只能包含小写字母、数字和连字符，长度不超过 64")
	}
	if err := validateBizCodeEnabled(in.BizCode, bizStore); err != nil {
		return err
	}
	if !containsString(models.ValidEnvs, strings.TrimSpace(in.Env)) {
		return fmt.Errorf("env 必须是 dev/test/staging/prod 之一，当前：%q", in.Env)
	}
	if !isValidStatus(in.Status) {
		return fmt.Errorf("status 必须是 online/offline/maintenance 之一（API 写请求不接受中文状态），当前：%q", in.Status)
	}
	return nil
}

// validateBizCodeEnabled 校验 biz_code 对应已启用业务字典条目（停用条目不可被新
// 资源选用，PRD §3.1）；字典加载失败时报错，避免在字典不可用时放行新资源。
func validateBizCodeEnabled(code string, bizStore *BusinessDomainStore) error {
	enabledMap, err := bizStore.GetEnabledMap()
	if err != nil {
		return fmt.Errorf("业务分组字典加载失败：%w", err)
	}
	if _, ok := enabledMap[code]; !ok {
		return fmt.Errorf("业务 %s 未登记或已停用，请联系平台管理员在业务分组字典配置（platform/config/business_domains.yaml）中添加或启用后重试", code)
	}
	return nil
}

func validateHost(in *ResourceInput) error {
	if strings.TrimSpace(in.InstanceIP) == "" {
		return fmt.Errorf("instance_ip 必填")
	}
	if !IsValidIPv4(in.InstanceIP) {
		return fmt.Errorf("instance_ip 格式不正确：%q（应为 IPv4）", in.InstanceIP)
	}
	// hostname（§5.6 ✅）经映射为 instance_name 列；host 模板 instance_name 必填（§5.16.1）。
	if strings.TrimSpace(in.InstanceName) == "" && strings.TrimSpace(in.Hostname) == "" {
		return fmt.Errorf("instance_name 必填")
	}
	return nil
}

func validateDatabase(in *ResourceInput) error {
	if strings.TrimSpace(in.DatabaseType) == "" {
		return fmt.Errorf("database_type 必填")
	}
	if strings.TrimSpace(in.AppName) == "" {
		return fmt.Errorf("app_name 必填")
	}
	if strings.TrimSpace(in.Cluster) == "" {
		return fmt.Errorf("cluster 必填")
	}
	return validateIPPortResource(in)
}

func validateMiddleware(in *ResourceInput) error {
	if strings.TrimSpace(in.MiddlewareType) == "" {
		return fmt.Errorf("middleware_type 必填")
	}
	if strings.TrimSpace(in.AppName) == "" {
		return fmt.Errorf("app_name 必填")
	}
	if strings.TrimSpace(in.Cluster) == "" {
		return fmt.Errorf("cluster 必填")
	}
	return validateIPPortResource(in)
}

// validateIPPortResource 校验 database/middleware 的 instance_ip（IPv4）与
// port（必填，1~65535）。
func validateIPPortResource(in *ResourceInput) error {
	if strings.TrimSpace(in.InstanceIP) == "" {
		return fmt.Errorf("instance_ip 必填")
	}
	if !IsValidIPv4(in.InstanceIP) {
		return fmt.Errorf("instance_ip 格式不正确：%q（应为 IPv4）", in.InstanceIP)
	}
	if in.Port < 1 || in.Port > 65535 {
		return fmt.Errorf("port 必须在 1~65535 之间，当前：%d", in.Port)
	}
	return nil
}

func validateApplication(in *ResourceInput) error {
	if strings.TrimSpace(in.ServiceName) == "" {
		return fmt.Errorf("service_name 必填")
	}
	if strings.TrimSpace(in.AppName) == "" {
		return fmt.Errorf("app_name 必填")
	}
	if strings.TrimSpace(in.Cluster) == "" {
		return fmt.Errorf("cluster 必填")
	}
	if strings.TrimSpace(in.Endpoint) == "" {
		return fmt.Errorf("endpoint 必填")
	}
	if in.Port < 0 || in.Port > 65535 {
		return fmt.Errorf("port 必须在 1~65535 之间，当前：%d", in.Port)
	}
	if strings.TrimSpace(in.HealthCheckURL) != "" {
		if err := ValidateHealthCheckURL(in.HealthCheckURL); err != nil {
			return err
		}
	}
	if strings.TrimSpace(in.Protocol) != "" && !containsString(models.ValidProtocols, in.Protocol) {
		return fmt.Errorf("protocol 必须是 http/https/tcp 之一，当前：%q", in.Protocol)
	}
	return nil
}

func validateGenericTarget(in *ResourceInput) error {
	if strings.TrimSpace(in.TargetName) == "" {
		return fmt.Errorf("target_name 必填")
	}
	if strings.TrimSpace(in.InstanceIP) == "" {
		return fmt.Errorf("instance_ip 必填")
	}
	if !IsValidInstanceIP(in.InstanceIP) {
		return fmt.Errorf("instance_ip 格式不正确：%q（应为 IPv4 或域名）", in.InstanceIP)
	}
	if in.Port < 0 || in.Port > 65535 {
		return fmt.Errorf("port 必须在 1~65535 之间，当前：%d", in.Port)
	}
	if strings.TrimSpace(in.Scheme) != "" && !containsString(models.ValidSchemes, in.Scheme) {
		return fmt.Errorf("scheme 必须是 http/https 之一，当前：%q", in.Scheme)
	}
	return nil
}

// IsValidIPv4 reports whether s is a dotted-quad IPv4 address（Module_07 §5.16.2）。
func IsValidIPv4(s string) bool {
	ip := net.ParseIP(strings.TrimSpace(s))
	return ip != nil && ip.To4() != nil
}

// IsValidInstanceIP reports whether s 是合法的目标地址：IPv4 或域名（generic_target
// 允许域名，Module_07 §5.9/§5.16.2）。纯数字加点号（如 "10.0.0"）既非合法 IPv4
// 也非域名，判为非法。
func IsValidInstanceIP(s string) bool {
	s = strings.TrimSpace(s)
	if IsValidIPv4(s) {
		return true
	}
	if s == "" || len(s) > 253 {
		return false
	}
	hasLetter := false
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			hasLetter = true
			continue
		}
		if (r >= '0' && r <= '9') || r == '-' || r == '.' {
			continue
		}
		return false
	}
	return hasLetter
}

// ValidateHealthCheckURL 校验健康检查 URL 为合法 HTTP/TCP URL
// （Module_07 §5.16.2：http/https/tcp + 非空 host）。
func ValidateHealthCheckURL(raw string) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return fmt.Errorf("health_check_url 格式不正确：%q", raw)
	}
	if !containsString(models.ValidProtocols, u.Scheme) {
		return fmt.Errorf("health_check_url 的协议必须是 http/https/tcp 之一，当前：%q", u.Scheme)
	}
	if u.Host == "" {
		return fmt.Errorf("health_check_url 缺少主机：%q", raw)
	}
	return nil
}

// DedupKey 按资源类型生成判重键（Module_07 §5.16.2），均以 network_domain_id
// 收敛（跨区 IP 复用语义）：
//
//	host                  = (network_domain_id, instance_ip)
//	database/middleware/generic_target = (network_domain_id, instance_ip, port)
//	application           = (network_domain_id, service_name, endpoint)
//
// 该键即导入 upsert 的更新定位键，与 resource_id（服务端 uuid）解耦。
func DedupKey(category models.ResourceCategory, in *ResourceInput) string {
	if in == nil {
		return ""
	}
	domain := strings.TrimSpace(in.NetworkDomainID)
	switch category {
	case models.ResourceCategoryHost:
		return fmt.Sprintf("%s|%s|%s", category, domain, strings.TrimSpace(in.InstanceIP))
	case models.ResourceCategoryDatabase, models.ResourceCategoryMiddleware, models.ResourceCategoryGenericTarget:
		return fmt.Sprintf("%s|%s|%s|%d", category, domain, strings.TrimSpace(in.InstanceIP), in.Port)
	case models.ResourceCategoryApplication:
		return fmt.Sprintf("%s|%s|%s|%s", category, domain, strings.TrimSpace(in.ServiceName), strings.TrimSpace(in.Endpoint))
	}
	return ""
}

// LegacyFieldMap 返回某类型资源「PRD 规范字段名 → 现模型列名」的映射（实现见
// models 包，T07-03 字段映射 helper），供 T07-05/06 序列化与标签生成复用。
func LegacyFieldMap(c models.ResourceCategory) map[string]string {
	return models.LegacyFieldMap(c)
}

// GetResourceField 从具体资源模型读取 PRD 规范字段的值（实现见 models 包，
// T07-03 字段映射 helper）。字段未映射或模型类型不支持时返回 ("", false)。
func GetResourceField(res any, field string) (string, bool) {
	return models.GetResourceField(res, field)
}

func isValidCategory(c models.ResourceCategory) bool {
	for _, valid := range models.ValidResourceCategories() {
		if c == valid {
			return true
		}
	}
	return false
}

func isValidStatus(s string) bool {
	_, ok := validStatuses[models.ResourceStatus(s)]
	return ok
}

func containsString(list []string, v string) bool {
	for _, item := range list {
		if item == v {
			return true
		}
	}
	return false
}
