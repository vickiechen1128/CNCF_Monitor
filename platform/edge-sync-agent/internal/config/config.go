// Package config 负责 Edge Sync Agent 的启动配置：从环境变量读取身份与中心地址，
// 并提供 §6.4.1 WAL / remote_write 默认值与心跳 / 退避 / 熔断等周期参数。
package config

import (
	"fmt"
	"os"
	"time"
)

// 心跳汇报周期（§6.4.2）。
const (
	DefaultHeartbeatInterval     = 30 * time.Second
	DefaultHealthCheckInterval   = 10 * time.Second
	DefaultHTTPTimeout           = 10 * time.Second
	DefaultBackoffMin            = 5 * time.Second
	DefaultBackoffMax            = 60 * time.Second
	DefaultAuthDowngradeAfter    = 10 * time.Minute
	DefaultAuthDowngradeInterval = 5 * time.Minute
)

// WAL / remote_write 参数默认值（PRD §6.4.1）。
const (
	DefaultWalMaxSize             = "20GB"
	DefaultWalMinBackfillAge      = "1h"
	DefaultRWQueueMaxSamplesPerSend = 2000
	DefaultRWQueueMaxShards       = 50
	DefaultRWRetryOnRateLimit     = true
	DefaultRWCompression          = "snappy"
)

// Config 是 Edge Sync Agent 运行配置。
type Config struct {
	// 身份（必填）：网域 ID、Token、中心接入地址。
	NetworkDomainID string
	Token           string
	CenterEndpoint  string

	// 采集器与 Agent 身份。
	AgentType string
	Version   string

	// 周期与退避。
	HeartbeatInterval     time.Duration
	HealthCheckInterval   time.Duration
	HTTPTimeout           time.Duration
	BackoffMin            time.Duration
	BackoffMax            time.Duration
	AuthDowngradeAfter    time.Duration
	AuthDowngradeInterval time.Duration

	// WAL / remote_write（§6.4.1），本包仅承载默认值，供后续生成 vmagent 参数用。
	WalMaxSize               string
	WalMinBackfillAge        string
	RWQueueMaxSamplesPerSend int
	RWQueueMaxShards         int
	RWRetryOnRateLimit       bool
	RWCompression            string
}

// Defaults 返回一份使用全部默认参数、身份待填的配置。
func Defaults() *Config {
	return &Config{
		HeartbeatInterval:     DefaultHeartbeatInterval,
		HealthCheckInterval:   DefaultHealthCheckInterval,
		HTTPTimeout:           DefaultHTTPTimeout,
		BackoffMin:            DefaultBackoffMin,
		BackoffMax:            DefaultBackoffMax,
		AuthDowngradeAfter:    DefaultAuthDowngradeAfter,
		AuthDowngradeInterval: DefaultAuthDowngradeInterval,
		WalMaxSize:            DefaultWalMaxSize,
		WalMinBackfillAge:     DefaultWalMinBackfillAge,
		RWQueueMaxSamplesPerSend: DefaultRWQueueMaxSamplesPerSend,
		RWQueueMaxShards:      DefaultRWQueueMaxShards,
		RWRetryOnRateLimit:    DefaultRWRetryOnRateLimit,
		RWCompression:         DefaultRWCompression,
	}
}

// 环境变量名（PRD §6.4 条目 1）。
const (
	EnvNetworkDomainID = "NETWORK_DOMAIN_ID"
	EnvToken           = "TOKEN"
	EnvCenterEndpoint  = "CENTER_ENDPOINT"
	// 可选覆盖项。
	EnvAgentType = "EDGE_AGENT_TYPE"
	EnvVersion   = "EDGE_AGENT_VERSION"
)

// Load 从环境变量读取配置。NETWORK_DOMAIN_ID / TOKEN / CENTER_ENDPOINT 必填，
// 缺失返回错误；其余使用默认值 + 可选环境覆盖。
func Load() (*Config, error) {
	cfg := Defaults()
	missing := []string{}
	get := func(key string) (string, bool) {
		v, ok := os.LookupEnv(key)
		return v, ok && v != ""
	}

	domain, ok := get(EnvNetworkDomainID)
	if !ok {
		missing = append(missing, EnvNetworkDomainID)
	}
	cfg.NetworkDomainID = domain

	token, ok := get(EnvToken)
	if !ok {
		missing = append(missing, EnvToken)
	}
	cfg.Token = token

	endpoint, ok := get(EnvCenterEndpoint)
	if !ok {
		missing = append(missing, EnvCenterEndpoint)
	}
	cfg.CenterEndpoint = endpoint

	if len(missing) > 0 {
		return nil, fmt.Errorf("config: missing required env var(s): %v", missing)
	}

	cfg.AgentType = DefaultAgentTypeOverride(EnvAgentType)
	cfg.Version = envDefault(EnvVersion, "dev")
	return cfg, nil
}

// DefaultAgentTypeOverride 可选覆盖采集器类型（默认 vmagent）。
func DefaultAgentTypeOverride(envKey string) string {
	if v := os.Getenv(envKey); v != "" {
		return v
	}
	return "vmagent"
}

func envDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
