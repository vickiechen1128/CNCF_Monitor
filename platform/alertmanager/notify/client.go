package notify

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// outboundHTTPClient 是通知渲染桥统一收敛的出站 HTTP 客户端：一处配置 CA
// （系统信任库 + 可选额外 CA 文件），避免各渠道各自处理 TLS（对齐用户自建脚本
// 依赖 certifi 兜底系统 CA 缺失的通用坑）。测试可替换为指向 httptest 的客户端。
var outboundHTTPClient = newOutboundHTTPClient()

// newOutboundHTTPClient 构造出站客户端：克隆默认 Transport，注入统一 TLS 配置。
// 额外 CA 通过 NOTIFY_BRIDGE_CA_FILE 指定（PEM bundle），用于系统 CA 缺失的环境。
func newOutboundHTTPClient() *http.Client {
	pool, err := x509.SystemCertPool()
	if err != nil || pool == nil {
		pool = x509.NewCertPool()
	}
	if extra := os.Getenv("NOTIFY_BRIDGE_CA_FILE"); extra != "" {
		if pem, err := os.ReadFile(extra); err == nil {
			pool.AppendCertsFromPEM(pem)
		}
	}
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.TLSClientConfig = &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}
	return &http.Client{Transport: tr, Timeout: 15 * time.Second}
}

// sendOutbound 向目标机器人地址 POST JSON body，返回 HTTP 状态码。非 2xx 亦返回
// 状态码 + 错误，由调用方判定失败并记录结构化日志；响应体仅少量读取后丢弃
// （不落库、不回显给客户端）。
func sendOutbound(ctx context.Context, target string, body []byte) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := outboundHTTPClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp.StatusCode, fmt.Errorf("notify target returned status %d", resp.StatusCode)
	}
	return resp.StatusCode, nil
}