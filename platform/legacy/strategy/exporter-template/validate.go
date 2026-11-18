package exportertemplate

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
)

// validateHTTPURL 校验采集器下载/主页 URL：scheme ∈ {http,https} 且 host 非空。
// 空串视为未提供（download_url/homepage 均为可选字段，仅非空时校验）。
// 复用《03_API_Standard》/ 控制面 parseURL 的 scheme+host 口径，仅收紧为空视为合法。
func validateHTTPURL(field, raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("%s 格式不正确：%q", field, raw)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("%s 的 scheme 必须是 http/https，当前：%q", field, u.Scheme)
	}
	if u.Host == "" {
		return fmt.Errorf("%s 缺少主机：%q", field, raw)
	}
	return nil
}

// normalizeSupportedMonitorTypes 校验并归一采集器声明的 supported_monitor_types
// （create/update 共用）：逐元素按 models.ValidMonitorType() 校验，非法取值直接
// 报错，把"拼错的监控对象类型"拦在登记时——否则模板入库成功却对所有 monitor_type
// 都不可用（scrapejob.validateExporterForMonitorType 的可用类型并集不认它），
// 用户表现为"明明登记了采集器却被告知该类型无可用采集器"，且无从追溯原因。
//
// 三条口径：
//  1. 空声明（nil / 空数组）原样放行：这是存量兼容语义，下游
//     exporterTemplateSupportsType / ensureExporterSupportsType 均把"未标注"视为
//     通配（对该类型可用）。收紧会让存量未标注模板集体失效，故此处不做要求。
//  2. 空白元素（""/ 纯空格）剔除而非报错：语义等价于"未标注"，与上面通配口径一致。
//  3. 重复值去重并保留首次出现顺序：语义上等价（下游只做包含性判断），但保证
//     同一份声明反复保存得到同一序列，不会产生无谓 diff。
func normalizeSupportedMonitorTypes(types []string) ([]string, error) {
	if len(types) == 0 {
		return types, nil
	}
	out := make([]string, 0, len(types))
	seen := make(map[string]bool, len(types))
	for _, raw := range types {
		mt := strings.TrimSpace(raw)
		if mt == "" {
			continue // 空白元素等价于未标注，剔除（见函数注释口径 2）
		}
		if !models.ValidMonitorType(mt) {
			return nil, fmt.Errorf("supported_monitor_types 含非法监控对象类型 %q，合法取值：%s",
				raw, strings.Join(models.ValidMonitorTypes(), " / "))
		}
		if seen[mt] {
			continue // 重复值去重，保留首次出现顺序（见函数注释口径 3）
		}
		seen[mt] = true
		out = append(out, mt)
	}
	return out, nil
}
