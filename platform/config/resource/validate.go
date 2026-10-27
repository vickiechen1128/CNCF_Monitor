package resource

import (
	"fmt"
	"log"
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
	AppCode          string `json:"app_code"` // 不可变应用编码（决策 92：资源侧只存 app_code）
	// PlatformCode 是资源行一等字段（决策 110，修订决策 104）：可空，留空时
	// platform 标签经所属应用 app_platform_rel 的 is_primary 平台兜底填充。
	PlatformCode string `json:"platform_code"`
	Cluster      string `json:"cluster"`
	Owner        string `json:"owner"`
	Status       string `json:"status"`
	Env          string `json:"env"`
	SourceType   string `json:"source_type"`

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
	ServiceName string `json:"service_name"`
	// HealthCheckURL 是 blackbox 拨测目标地址，必填，也可作为标签模板来源。
	HealthCheckURL string `json:"health_check_url"`
	// Protocol 仅作资源画像与标签来源，不参与采集地址（采集协议取自 M01 采集 Job 的 scheme）。
	Protocol string `json:"protocol"`
	// Endpoint（主机，IPv4/域名）与 Port（采集端口，如 exporter 监听端口）共同构成
	// application 的 standard 采集地址 `endpoint:port`，二者均可选。
	Endpoint string `json:"endpoint"`

	// generic_target（§5.9）
	TargetName   string            `json:"target_name"`
	MetricsPath  string            `json:"metrics_path"`
	Scheme       string            `json:"scheme"`
	ExporterType string            `json:"exporter_type"`
	CustomLabels map[string]string `json:"custom_labels"`

	// interface_service（第 6 类，接口服务）：类型专属字段。
	// APIName 为展示名；APIURL 是**完整 URL**（含 `?` 查询参数，如
	// https://api.example.com/health?token=xxx），拨测目标地址直接取该值。
	APIName string `json:"api_name"`
	APIURL  string `json:"api_url"`

	// ScrapePort 是实例级采集端口覆盖（M07 PRD §5.2 可选 int，五类通用）：
	// 0=未指定（缺省），留空时由 M09 四级端口解析链回落（scrape_port → 映射 →
	// 模板 → 业务 port，提案 resource-scrape-port-chain §5.1）。
	ScrapePort int `json:"scrape_port"`
}

// KeepDisabledValues 承载「编辑保留停用历史值」的放行集合（决策 92/93 红线）：
// 请求体值与资源当前值相同、且该字典条目已停用时，跳过对应启用态校验（提示并
// 允许保留历史值）；修改为新值 / 新选用停用条目仍被拒绝。仅更新（PUT）场景注入。
type KeepDisabledValues struct {
	BizCode      string // 资源当前 biz_code（停用历史值保留）
	AppCode      string // 资源当前 app_code（停用历史值保留）
	PlatformCode string // 资源当前 platform_code（停用 / 历史不自洽值保留，决策 110）
}

// PlatformRefs 承载资源行 platform_code 的校验依赖（决策 110）：PlatformStore
// 提供平台字典启用条目（取值权威），AppPlatformStore 提供应用↔平台关联集合
// （自洽校验）。
//
// 校验口径：①platform_code 可空，留空不校验（走所属应用主平台兜底）；②填值须
// 命中平台字典 enabled=true 条目；③app_code 非空且该应用存在关联平台时，
// platform_code 须属于该应用的关联平台集合，否则 bad_request「平台 xxx 不属于
// 应用 yyy 的关联平台」；app_code 为空或应用无关联平台时不校验自洽。
// platform 为 nil（或子 store 为 nil）时跳过平台校验——仅供单元测试，生产
// handler 始终注入真实 store。
type PlatformRefs struct {
	PlatformStore    *PlatformDictStore
	AppPlatformStore *AppPlatformStore
}

// ValidateResourceInput 校验资源写请求/导入行输入（纯函数，外部副作用仅来自注入的
// bizStore 与 networkDomainExists）：
//
//   - 必填项：按类型差异化（host/database/middleware 的 biz_code 可空后补、app_code
//     对 host/generic_target 可空；application 的 biz_code 与 app_code 必填；
//     generic_target 的 app_code/biz_code 二选一，§5.2 ✅* 决策 93/95）；
//   - 枚举：env∈ValidEnvs、protocol∈ValidProtocols、scheme∈ValidSchemes、
//     status 仅 online/offline/maintenance（不接受中文状态）；
//   - 格式：instance_ip IPv4（generic_target 另允许域名）、port 1~65535、
//     health_check_url（非空时）为合法 HTTP/TCP URL；
//   - 存在性：biz_code 若填须对应已启用业务字典条目（host/db/middleware 为空时
//     不校验存在性，§3.1/决策 93）；app_code 若填写须对应已启用应用字典条目
//     （决策 92 红线：资源侧 app_code 只允许引用未停用条目）；
//     network_domain_id 经 networkDomainExists 校验（M06 行政记录，default 例外由
//     调用方决定）。
//
// 校验失败返回含字段名的错误，供 handler 包装为 bad_request（§6.6.1）。
func ValidateResourceInput(category models.ResourceCategory, in *ResourceInput, bizStore *BusinessDomainStore, appStore *ApplicationDictStore, networkDomainExists func(string) bool) error {
	return validateResourceInput(category, in, bizStore, appStore, networkDomainExists, nil, nil)
}

// ValidateResourceInputForUpdate 与 ValidateResourceInput 同校验，但允许「编辑保留
// 停用历史值」（决策 92/93）：keep 指向资源当前值，请求体值与其相同时跳过对应
// 启用态校验（提示并允许保留历史值），修改为新值仍被拒绝。
func ValidateResourceInputForUpdate(category models.ResourceCategory, in *ResourceInput, bizStore *BusinessDomainStore, appStore *ApplicationDictStore, networkDomainExists func(string) bool, keep *KeepDisabledValues) error {
	return validateResourceInput(category, in, bizStore, appStore, networkDomainExists, keep, nil)
}

// ValidateResourceInputWithPlatform 与 ValidateResourceInput 同校验，并追加资源行
// platform_code 一等字段校验（决策 110）：platform 为 nil 时跳过平台校验（行为与
// ValidateResourceInput 完全一致）。生产写链路（POST/PUT/Excel 导入）均注入真实
// platform/app_platform store；单测可传 nil 跳过。
func ValidateResourceInputWithPlatform(category models.ResourceCategory, in *ResourceInput, bizStore *BusinessDomainStore, appStore *ApplicationDictStore, networkDomainExists func(string) bool, platform *PlatformRefs) error {
	return validateResourceInput(category, in, bizStore, appStore, networkDomainExists, nil, platform)
}

// ValidateResourceInputWithPlatformForUpdate 是 ValidateResourceInputWithPlatform 的
// 编辑态版本：keep 提供资源当前 platform_code，请求体值与其相同时允许保留历史值
// （已停用平台 / 与应用平台集合不自洽的历史值均不阻断）；改为新值 / 新选停用平台
// 仍被拒绝。
func ValidateResourceInputWithPlatformForUpdate(category models.ResourceCategory, in *ResourceInput, bizStore *BusinessDomainStore, appStore *ApplicationDictStore, networkDomainExists func(string) bool, keep *KeepDisabledValues, platform *PlatformRefs) error {
	return validateResourceInput(category, in, bizStore, appStore, networkDomainExists, keep, platform)
}

func validateResourceInput(category models.ResourceCategory, in *ResourceInput, bizStore *BusinessDomainStore, appStore *ApplicationDictStore, networkDomainExists func(string) bool, keep *KeepDisabledValues, platform *PlatformRefs) error {
	if in == nil {
		return fmt.Errorf("resource input 不能为空")
	}
	if !isValidCategory(category) {
		return fmt.Errorf("resource_category 非法：%s", category)
	}
	if err := validateCommon(in, bizStore, appStore, networkDomainExists, keep, platform); err != nil {
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
	case models.ResourceCategoryInterfaceService:
		return validateInterfaceService(in)
	}
	return nil
}

// validateCommon 校验五类共享字段：网域存在性、biz_code（若填）格式与启用、app_code
// （若填）须对应启用应用字典条目、env/status 枚举。必填分化不在本函数内——按类型
// 差异化必填由各 validate* 分派（决策 93/95：application 的 biz 必填在
// validateApplication、generic_target 二选一在 validateGenericTarget）。
// 决策 110：platform_code 一等字段校验同在此处（validatePlatformCode）。
func validateCommon(in *ResourceInput, bizStore *BusinessDomainStore, appStore *ApplicationDictStore, networkDomainExists func(string) bool, keep *KeepDisabledValues, platform *PlatformRefs) error {
	if strings.TrimSpace(in.NetworkDomainID) == "" {
		return fmt.Errorf("network_domain_id 必填")
	}
	if networkDomainExists != nil && !networkDomainExists(in.NetworkDomainID) {
		return fmt.Errorf("网域 %s 未登记，请先到『系统设置 → 网域管理』登记后重试", in.NetworkDomainID)
	}
	// 决策 93：biz_code 非空时校验编码规范与启用条目（host/db/middleware 可空后补，
	// 为空时不校验存在性、不注入 biz 标签）；编辑保留停用历史值经 keep 豁免。
	if strings.TrimSpace(in.BizCode) != "" {
		if !models.ValidBizCode.MatchString(in.BizCode) {
			return fmt.Errorf("biz_code 只能包含小写字母、数字和连字符，长度不超过 64")
		}
		if keep == nil || in.BizCode != keep.BizCode {
			if err := validateBizCodeEnabled(in.BizCode, bizStore); err != nil {
				return err
			}
		}
	}
	// 决策 92：app_code 若填写须引用已启用应用字典条目（停用/未登记不允许选用）；
	// 编辑保留停用历史值经 keep 豁免。先校验编码规范（与 biz_code 同构），非法格式
	// 给出明确文案，避免被「未登记或已停用」兜底误报。
	if strings.TrimSpace(in.AppCode) != "" {
		if !models.ValidAppCode.MatchString(in.AppCode) {
			return fmt.Errorf("app_code 只能包含小写字母、数字和连字符，长度不超过 64")
		}
		if keep == nil || in.AppCode != keep.AppCode {
			if err := validateAppCodeEnabled(in.AppCode, appStore); err != nil {
				return err
			}
		}
	}
	// 决策 110：platform_code 可空一等字段——留空不校验（走所属应用主平台兜底），
	// 填值须为启用平台字典条目且与所属 app_code 的平台集合自洽。
	if err := validatePlatformCode(in, platform, keep); err != nil {
		return err
	}
	if !containsString(models.ValidEnvs, strings.TrimSpace(in.Env)) {
		return fmt.Errorf("env 必须是 %s 之一，当前：%q", strings.Join(models.ValidEnvs, "/"), in.Env)
	}
	if !isValidStatus(in.Status) {
		return fmt.Errorf("status 必须是 online/offline/maintenance 之一（API 写请求不接受中文状态），当前：%q", in.Status)
	}
	return nil
}

// validatePlatformCode 校验资源行 platform_code 一等字段（决策 110）：
//   - 空值：合法，不校验（platform 标签由所属应用 is_primary 平台兜底填充）；
//   - 编辑保留历史值：请求体值与资源当前值相同时跳过全部平台校验（已停用平台 /
//     与应用平台集合不自洽的历史值均允许保留）；改为新值 / 新选停用平台仍拒绝；
//   - 填值：须命中平台字典启用条目；未命中时用 Lookup 区分「已停用」（引导『平台
//     管理』页启用）与「未登记」（引导登记，或在本文件『平台声明』sheet 声明后
//     重新导入），与 biz_code / app_code 的引导口径保持一致；
//   - 自洽：app_code 非空且该应用存在关联平台时，填值须落在关联平台集合内，
//     否则「平台 xxx 不属于应用 yyy 的关联平台」；app_code 为空 / 应用无关联
//     平台时不校验自洽。
//
// refs 为 nil（或子 store 为 nil）时跳过平台校验并打 warn 日志（仅供单元测试
// 便捷调用；生产写路径必须注入完整 PlatformRefs，见 create.go / update.go /
// import.go 三处构造点）。
func validatePlatformCode(in *ResourceInput, refs *PlatformRefs, keep *KeepDisabledValues) error {
	code := strings.TrimSpace(in.PlatformCode)
	if code == "" {
		return nil // 可空：留空走兜底，不校验
	}
	if keep != nil && code == strings.TrimSpace(keep.PlatformCode) {
		return nil // 编辑保留历史平台值（停用 / 不自洽均放行）
	}
	if refs == nil || refs.PlatformStore == nil {
		// 非 fail-closed 是有意取舍（refs 为 nil 仅供单元测试），但静默放行会让
		// 「新增写路径漏注入 PlatformRefs」演变为无痕的平台校验失效。故打显式
		// 告警日志：控制流不变（零行为变更、零测试影响），但把静默失效转为
		// 可疑信号。生产三处构造点（create.go / update.go / import.go）均已完整
		// 注入两个 store，出现此日志即代表新增写路径遗漏。
		log.Printf("[resource-validate] platform_code=%q 校验被跳过：PlatformRefs 或 PlatformStore 为 nil（写路径未注入平台 store？）", code)
		return nil
	}
	enabled, err := refs.PlatformStore.GetEnabledMap()
	if err != nil {
		return fmt.Errorf("平台字典加载失败：%w", err)
	}
	if _, ok := enabled[code]; !ok {
		// 与 excel.go 的 biz_code / app_code 同构：用 Lookup 区分
		// 「已停用」与「未登记」两种情形——条目存在但停用引导「启用」，条目不存在
		// 才引导「登记」。前端 isPendingRegistrationReason 仅匹配含「未登记」的文案，
		// 停用态不被误标为待登记高亮。
		//
		// 未登记文案同时给出两条路径：去『平台管理』页登记，或在本文件『平台声明』
		// sheet 补充后重新导入（该 sheet 由 excel_declare.go 的 platformDeclareSheet
		// 解析、经 import.go 的 applyDeclaredDicts 与资源落库同事务原子提交），与
		// biz / app / service 三处保持一致的能力口径。
		_, found, lerr := refs.PlatformStore.Lookup(code)
		if lerr != nil {
			return fmt.Errorf("查询平台 %s 失败：%w", code, lerr)
		}
		if found {
			return fmt.Errorf("平台 %s 已停用，请在『平台管理』页启用后重新导入", code)
		}
		return fmt.Errorf("平台 %s 未登记且未在声明 sheet 声明，请在『平台管理』页登记，或在本文件『平台声明』sheet 补充后重新导入。若你使用的是旧模板，可能缺少最新字典值，请重新下载模板后填写", code)
	}
	appCode := strings.TrimSpace(in.AppCode)
	if appCode == "" {
		return nil // 无所属应用时不校验自洽
	}
	if refs.AppPlatformStore == nil {
		// 同上：自洽校验静默失效的可疑信号，不改控制流。
		log.Printf("[resource-validate] platform_code=%q 与 app_code=%q 的自洽校验被跳过：AppPlatformStore 为 nil（写路径未注入应用平台关联 store？）", code, appCode)
		return nil
	}
	platforms, err := refs.AppPlatformStore.PlatformCodesOf(appCode)
	if err != nil {
		return fmt.Errorf("应用 %s 关联平台加载失败：%w", appCode, err)
	}
	if len(platforms) == 0 {
		return nil // 应用无关联平台时不校验自洽
	}
	for _, p := range platforms {
		if p == code {
			return nil
		}
	}
	return fmt.Errorf("平台 %s 不属于应用 %s 的关联平台", code, appCode)
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

// validateAppCodeEnabled 校验 app_code 对应已启用应用字典条目（决策 92 红线：资源侧
// app_code 只允许引用未停用条目）。appStore 为 nil 时跳过（仅供单元测试；生产 handler
// 始终传入真实 store），字典加载失败时报错，避免在字典不可用时放行新资源。
func validateAppCodeEnabled(code string, appStore *ApplicationDictStore) error {
	if appStore == nil {
		return nil // 测试可传 nil 跳过；生产 handler 始终传入真实 store
	}
	enabledMap, err := appStore.GetEnabledMap()
	if err != nil {
		return fmt.Errorf("应用字典加载失败：%w", err)
	}
	if _, ok := enabledMap[code]; !ok {
		return fmt.Errorf("应用 %s 未登记或已停用，请在『应用字典』中登记或启用后重试", code)
	}
	return nil
}

// validateScrapePort 校验实例级采集端口覆盖 scrape_port（可选，五类同口径）：
// 0（未指定）合法，填值须在 1~65535；错误消息以 scrape_port 开头，供 excel.go
// 的 resourceInputFieldPrefixes 前缀映射回 §5.16.3 的 field。
func validateScrapePort(in *ResourceInput) error {
	if in.ScrapePort != 0 && (in.ScrapePort < 1 || in.ScrapePort > 65535) {
		return fmt.Errorf("scrape_port 必须为 0（未指定）或 1~65535，当前：%d", in.ScrapePort)
	}
	return nil
}

// validateHost 校验 host 资源必填字段（决策 93：host 的 biz_code 可空后补）。
func validateHost(in *ResourceInput) error {
	if err := validateScrapePort(in); err != nil {
		return err
	}
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
	// os_type 必填：host 采集语法依赖 os_type 定位实例（M01 monitor_type=linux/windows
	// 由 OSKeywords 匹配 image/os_type，见 platform/models/monitor_type.go），为空则所选
	// 实例在采集 Job 候选中被排除。dev-feedback §7 登记 PRD 标注与此口径不一致。
	if strings.TrimSpace(in.OSType) == "" {
		return fmt.Errorf("os_type 必填")
	}
	return nil
}

func validateDatabase(in *ResourceInput) error {
	if err := validateScrapePort(in); err != nil {
		return err
	}
	if strings.TrimSpace(in.DatabaseType) == "" {
		return fmt.Errorf("database_type 必填")
	}
	if strings.TrimSpace(in.AppCode) == "" {
		return fmt.Errorf("app_code 必填")
	}
	// 决策 F（§5.2）：cluster 必填规则同 app_code —— host / generic_target 可空（设备类无集群归属，强制必填会逼填假数据污染 cluster 标签）；application / database / middleware 必填。空值不注入标签（5.15 规则 4）
	if strings.TrimSpace(in.Cluster) == "" {
		return fmt.Errorf("cluster 必填")
	}
	return validateIPPortResource(in)
}

func validateMiddleware(in *ResourceInput) error {
	if err := validateScrapePort(in); err != nil {
		return err
	}
	if strings.TrimSpace(in.MiddlewareType) == "" {
		return fmt.Errorf("middleware_type 必填")
	}
	if strings.TrimSpace(in.AppCode) == "" {
		return fmt.Errorf("app_code 必填")
	}
	// 决策 F（§5.2）：cluster 必填规则同 app_code —— host / generic_target 可空（设备类无集群归属，强制必填会逼填假数据污染 cluster 标签）；application / database / middleware 必填。空值不注入标签（5.15 规则 4）
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
	if err := validateScrapePort(in); err != nil {
		return err
	}
	// 决策 93：application 应用服务上线后 biz_code 必填（对应启用条目由
	// validateCommon 校验，host/db/middleware 不受此约束）。
	if strings.TrimSpace(in.BizCode) == "" {
		return fmt.Errorf("biz_code 必填（应用上线后须归属业务分组，可先在『业务管理』页登记）")
	}
	if strings.TrimSpace(in.ServiceName) == "" {
		return fmt.Errorf("service_name 必填")
	}
	if strings.TrimSpace(in.AppCode) == "" {
		return fmt.Errorf("app_code 必填")
	}
	// 决策 F（§5.2）：cluster 必填规则同 app_code —— host / generic_target 可空（设备类无集群归属，强制必填会逼填假数据污染 cluster 标签）；application / database / middleware 必填。空值不注入标签（5.15 规则 4）
	if strings.TrimSpace(in.Cluster) == "" {
		return fmt.Errorf("cluster 必填")
	}
	// health_check_url 是 blackbox 拨测目标地址，必填；standard 指标采集仍使用
	// endpoint + port，不用拨测 URL 代替指标端点。
	if strings.TrimSpace(in.HealthCheckURL) == "" {
		return fmt.Errorf("health_check_url 必填（应用拨测 URL）")
	}
	if err := ValidateHealthCheckURL(in.HealthCheckURL); err != nil {
		return err
	}
	// endpoint / port 仅服务 standard 指标采集，均可选；port=0 表示未设置。
	if in.Port < 0 || in.Port > 65535 {
		return fmt.Errorf("port 必须为 0（未设置）或 1~65535（应用采集端口），当前：%d", in.Port)
	}
	// protocol 仅作资源画像与标签来源，不参与采集地址（采集协议取自 M01 采集 Job 的 scheme）。
	if strings.TrimSpace(in.Protocol) != "" && !containsString(models.ValidProtocols, in.Protocol) {
		return fmt.Errorf("protocol 必须是 http/https/tcp 之一，当前：%q", in.Protocol)
	}
	return nil
}

func validateGenericTarget(in *ResourceInput) error {
	if err := validateScrapePort(in); err != nil {
		return err
	}
	// 决策 95：app_code 与 biz_code 二选一必填（两者皆空 bad_request，避免指标
	// 无归属）；非空侧的存在性/启用态校验已由 validateCommon 完成。
	if strings.TrimSpace(in.AppCode) == "" && strings.TrimSpace(in.BizCode) == "" {
		return fmt.Errorf("generic_target 的 app_code 与 biz_code 至少填写一个（决策 95 二选一）")
	}
	if strings.TrimSpace(in.TargetName) == "" {
		return fmt.Errorf("target_name 必填")
	}
	if strings.TrimSpace(in.InstanceIP) == "" {
		return fmt.Errorf("instance_ip 必填")
	}
	if !IsValidInstanceIP(in.InstanceIP) {
		return fmt.Errorf("instance_ip 格式不正确：%q（应为 IPv4 或域名）", in.InstanceIP)
	}
	// generic_target 的 port 可选：0 表示未设置（采集地址不带端口，见
	// instanceAddress）。范围校验为 0（未设置）或 1~65535；消息保留 "1~65535"
	// 子串以兼容 excel 导入校验测试（excel_test.go）。
	if in.Port < 0 || in.Port > 65535 {
		return fmt.Errorf("port 必须为 0（未设置）或 1~65535，当前：%d", in.Port)
	}
	if strings.TrimSpace(in.Scheme) != "" && !containsString(models.ValidSchemes, in.Scheme) {
		return fmt.Errorf("scheme 必须是 http/https 之一，当前：%q", in.Scheme)
	}
	return nil
}

// validateInterfaceService 校验「接口服务」（第 6 类资源）的必填字段与格式：
//   - api_name 必填，长度 ≤200；
//   - api_url 必填，长度 ≤500，且须为合法的绝对 HTTP(S) URL（url.Parse 通过、
//     scheme ∈ {http,https}、Host 非空）——拨测目标地址直接取该值，不合法会导致
//     拨测静默失败；
//   - biz_code 与 app_code 必填（validateCommon 只在非空时校验格式与启用态，
//     不强制必填，故此处显式补齐；决策「接口服务两项均必填」）。
//
// network_domain_id 必填与 biz_code / app_code 的启用态校验由 validateCommon 负责。
func validateInterfaceService(in *ResourceInput) error {
	if err := validateScrapePort(in); err != nil {
		return err
	}
	if strings.TrimSpace(in.APIName) == "" {
		return fmt.Errorf("api_name 必填")
	}
	if len(in.APIName) > 200 {
		return fmt.Errorf("api_name 长度不能超过 200，当前：%d", len(in.APIName))
	}
	if strings.TrimSpace(in.APIURL) == "" {
		return fmt.Errorf("api_url 必填")
	}
	if len(in.APIURL) > 500 {
		return fmt.Errorf("api_url 长度不能超过 500，当前：%d", len(in.APIURL))
	}
	if err := validateInterfaceServiceURL(in.APIURL); err != nil {
		return err
	}
	if strings.TrimSpace(in.BizCode) == "" {
		return fmt.Errorf("biz_code 必填（接口服务须归属业务分组，可先在『业务管理』页登记）")
	}
	if strings.TrimSpace(in.AppCode) == "" {
		return fmt.Errorf("app_code 必填")
	}
	return nil
}

// validateInterfaceServiceURL 校验接口服务的 api_url 为合法绝对 HTTP(S) URL：
// scheme 须为 http/https、Host 须非空（拒绝相对路径如 /health、其他协议如 ftp://）。
func validateInterfaceServiceURL(raw string) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return fmt.Errorf("api_url 格式不正确：%q", raw)
	}
	if !containsString([]string{"http", "https"}, u.Scheme) {
		return fmt.Errorf("api_url 的协议必须是 http/https 之一，当前：%q", u.Scheme)
	}
	if u.Host == "" {
		return fmt.Errorf("api_url 缺少主机：%q", raw)
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
//	application           = (network_domain_id, service_name, health_check_url)
//	interface_service     = (network_domain_id, api_url)
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
		return fmt.Sprintf("%s|%s|%s|%s", category, domain, strings.TrimSpace(in.ServiceName), strings.TrimSpace(in.HealthCheckURL))
	case models.ResourceCategoryInterfaceService:
		return fmt.Sprintf("%s|%s|%s", category, domain, strings.TrimSpace(in.APIURL))
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
