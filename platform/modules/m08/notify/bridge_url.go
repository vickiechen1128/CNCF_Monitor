package notify

import (
	"fmt"
	"net"
)

// DeriveBridgeBaseURL 由 metric-center 监听地址推导通知渲染桥基础地址（供 M09 物化
// receiver URL）。监听主机为空 / 通配（0.0.0.0 / ::）时回落回环地址 127.0.0.1
// （AM 与 metric-center 同机部署）；端口缺失返回错误，避免拼出不可达地址。
func DeriveBridgeBaseURL(listenAddr string) (string, error) {
	host, port, err := net.SplitHostPort(listenAddr)
	if err != nil {
		return "", fmt.Errorf("解析监听地址 %q: %w", listenAddr, err)
	}
	if port == "" {
		return "", fmt.Errorf("监听地址 %q 缺少端口", listenAddr)
	}
	switch host {
	case "", "0.0.0.0", "::":
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, port), nil
}
