package models

import "strings"

// BlackboxTargetProtocol is the probe protocol used by a blackbox target,
// aligned with Module_01 §5.4 "BlackboxTarget 结构".
type BlackboxTargetProtocol string

// Blackbox target protocol constants.
const (
	BlackboxTargetProtocolHTTP  BlackboxTargetProtocol = "http"
	BlackboxTargetProtocolHTTPS BlackboxTargetProtocol = "https"
	BlackboxTargetProtocolTCP   BlackboxTargetProtocol = "tcp"
	BlackboxTargetProtocolICMP  BlackboxTargetProtocol = "icmp"
	BlackboxTargetProtocolDNS   BlackboxTargetProtocol = "dns"
)

// ValidBlackboxTargetProtocols returns the authoritative protocol set.
func ValidBlackboxTargetProtocols() []BlackboxTargetProtocol {
	return []BlackboxTargetProtocol{
		BlackboxTargetProtocolHTTP,
		BlackboxTargetProtocolHTTPS,
		BlackboxTargetProtocolTCP,
		BlackboxTargetProtocolICMP,
		BlackboxTargetProtocolDNS,
	}
}

// ValidBlackboxTargetProtocol reports whether p is a known probe protocol.
func ValidBlackboxTargetProtocol(p string) bool {
	for _, v := range ValidBlackboxTargetProtocols() {
		if string(v) == strings.TrimSpace(p) {
			return true
		}
	}
	return false
}

// BlackboxTarget is a single probe target of a blackbox scrape job
// (job_type=blackbox), aligned with Module_01 §5.4.
type BlackboxTarget struct {
	Target   string                 `json:"target"`        // 探测目标地址 / IP / host:port
	Protocol BlackboxTargetProtocol `json:"protocol"`      // http/https/tcp/icmp/dns
	URL      string                 `json:"url,omitempty"` // HTTP/HTTPS 模块完整 URL，可选
}
