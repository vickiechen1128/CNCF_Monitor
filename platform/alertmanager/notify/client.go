package notify

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
)

// outboundHTTPClient 是通知渲染桥统一收敛的出站 HTTP 客户端：一处配置 CA
// （系统信任库 + 可选额外 CA 文件），避免各渠道各自处理 TLS（对齐用户自建脚本
// 依赖 certifi 兜底系统 CA 缺失的通用坑）。测试可替换为指向 httptest 的客户端。
var outboundHTTPClient = newOutboundHTTPClient()

// newOutboundHTTPClient 构造出站客户端：克隆默认 Transport，注入统一 TLS 配置。
// 额外 CA 通过 NOTIFY_BRIDGE_CA_FILE 指定（PEM bundle），用于系统 CA 缺失的环境。
// 禁跟随重定向：目标地址来自 DB 已登记渠道，跟随重定向会绕过目标约束（M-3）。
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
	return &http.Client{
		Transport: tr,
		Timeout:   15 * time.Second,
		// 不跟随 3xx：渠道机器人地址为最终投递目标，重定向属异常。
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
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
		// M-1：*url.Error 携带完整目标 URL（含机器人 webhook token），原样打日志/回显会
		// 外泄凭据，故脱敏为「操作 + 主机」后再向上返回。
		return 0, sanitizeOutboundError(err)
	}
	defer resp.Body.Close()
	// 限量读取响应体（4KB）：用于非 2xx 错误定位与 IM 业务错误码判定（防静默
	// 丢失兜底），不落库、不回显给客户端。
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp.StatusCode, fmt.Errorf("notify target returned status %d, body=%s",
			resp.StatusCode, strings.TrimSpace(string(respBody)))
	}
	// 防静默丢失兜底：IM 机器人常用「HTTP 200 + 业务错误码」表达失败（如飞书签名校验
	// 失败返回 code=19021），仅看状态码会误判成功、通知无声消失。此处判为错误，
	// 令桥返回 502 交由 AM 重试并记失败日志。
	if bizErr := checkOutboundBusinessError(respBody); bizErr != nil {
		return resp.StatusCode, bizErr
	}
	return resp.StatusCode, nil
}

// sanitizeOutboundError 剥离 *url.Error 中可能含凭据的完整目标 URL（M-1）：仅保留
// 操作名与主机（不含路径 / 查询，故不含 webhook token）。非 *url.Error 原样返回。
func sanitizeOutboundError(err error) error {
	var uerr *url.Error
	if !errors.As(err, &uerr) {
		return err
	}
	host := ""
	if u, perr := url.Parse(uerr.URL); perr == nil {
		host = u.Host
	}
	return fmt.Errorf("%s %s: %v", uerr.Op, host, uerr.Err)
}

// feishuSign 计算飞书自定义机器人签名校验值：
// 以 stringToSign = timestamp + "\n" + secret 作为 HMAC-SHA256 的 **key**，
// 对 **空串** 计算摘要后 Base64 编码。注意 key 与 msg 的位置不可互换，
// 与飞书开放平台「签名校验」官方示例（Go/Python/Java）保持一致，
// 顺序错误会返回 code=19021 sign match fail。
func feishuSign(secret, timestamp string) string {
	stringToSign := timestamp + "\n" + secret
	mac := hmac.New(sha256.New, []byte(stringToSign))
	mac.Write(nil) // 官方示例对空串计算摘要
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// applyFeishuSignature 为飞书渠道出站体注入 timestamp + sign：开启「签名校验」的
// 自定义机器人要求每个请求携带时间戳与签名，否则拒收（HTTP 200 + code=19021）。
// 仅「飞书渠道且已登记 secret」时生效；未开启签名校验（secret 为空）的渠道原样
// 返回，兼容存量配置。渲染体须为 JSON 对象（模板创建时已强制校验 JSON）。
func applyFeishuSignature(ch *models.NotifyChannel, rendered []byte, now time.Time) ([]byte, error) {
	if ch.Type != models.NotifyChannelTypeFeishu || strings.TrimSpace(ch.Secret) == "" {
		return rendered, nil
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(rendered, &payload); err != nil {
		return nil, fmt.Errorf("飞书签名注入失败（渲染体非 JSON 对象）: %w", err)
	}
	ts := strconv.FormatInt(now.Unix(), 10)
	payload["timestamp"] = ts
	payload["sign"] = feishuSign(ch.Secret, ts)
	signed, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("飞书签名注入失败（签名体序列化）: %w", err)
	}
	return signed, nil
}

// checkOutboundBusinessError 判定 IM 机器人 webhook 的业务错误码（防静默丢失兜底）：
// 飞书用 code，钉钉 / 企业微信用 errcode；非 0 一律判失败。响应体非 JSON 或无该
// 字段（如 PrometheusAlert 等代理类 webhook 返回 {"success":...}）不判错，避免
// 误伤无法识别的响应形态。
func checkOutboundBusinessError(respBody []byte) error {
	var payload struct {
		Code    *float64 `json:"code"`
		Msg     string   `json:"msg"`
		ErrCode *float64 `json:"errcode"`
		ErrMsg  string   `json:"errmsg"`
	}
	if err := json.Unmarshal(respBody, &payload); err != nil {
		return nil
	}
	code, msg := payload.Code, payload.Msg
	if code == nil {
		code, msg = payload.ErrCode, payload.ErrMsg
	}
	if code != nil && *code != 0 {
		return fmt.Errorf("notify target returned business error: code=%v msg=%s, body=%s",
			*code, msg, strings.TrimSpace(string(respBody)))
	}
	return nil
}