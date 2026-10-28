package models

// BlackboxModule 是全局共享的 blackbox_exporter 探测模块定义。
// Content 只包含一个模块节点，根键必须与 Name 一致。
type BlackboxModule struct {
	BaseModel
	Name    string `gorm:"size:64;not null;uniqueIndex" json:"name"`
	Content string `gorm:"type:text;not null" json:"content"`
	Enabled bool   `gorm:"not null;default:true" json:"enabled"`
}

// DefaultBlackboxModules 返回平台预置模块，初始化时仅在同名模块不存在时插入。
func DefaultBlackboxModules() []BlackboxModule {
	return []BlackboxModule{
		{Name: "http_2xx", Content: "http_2xx:\n  prober: http\n  timeout: 5s\n", Enabled: true},
		{Name: "icmp_ping", Content: "icmp_ping:\n  prober: icmp\n  timeout: 5s\n", Enabled: true},
		{Name: "tcp_connect", Content: "tcp_connect:\n  prober: tcp\n  timeout: 5s\n", Enabled: true},
		{Name: "dns_query", Content: "dns_query:\n  prober: dns\n  timeout: 5s\n", Enabled: true},
	}
}
