package exportertemplate

import (
	"fmt"
	"net/url"
	"strings"
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
