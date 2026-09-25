package config

import (
	"os"
	"testing"
	"time"
)

func TestDefaultsValues(t *testing.T) {
	c := Defaults()
	if c.HeartbeatInterval != 30*time.Second {
		t.Errorf("heartbeat interval = %s", c.HeartbeatInterval)
	}
	if c.BackoffMin != 5*time.Second || c.BackoffMax != 60*time.Second {
		t.Errorf("backoff = %s..%s", c.BackoffMin, c.BackoffMax)
	}
	if c.AuthDowngradeAfter != 10*time.Minute || c.AuthDowngradeInterval != 5*time.Minute {
		t.Errorf("downgrade = %s / %s", c.AuthDowngradeAfter, c.AuthDowngradeInterval)
	}
	if c.WalMaxSize != "20GB" || c.WalMinBackfillAge != "1h" {
		t.Errorf("wal params = %s / %s", c.WalMaxSize, c.WalMinBackfillAge)
	}
	if c.RWQueueMaxSamplesPerSend != 2000 || c.RWQueueMaxShards != 50 {
		t.Errorf("rw queue = %d / %d", c.RWQueueMaxSamplesPerSend, c.RWQueueMaxShards)
	}
	if !c.RWRetryOnRateLimit || c.RWCompression != "snappy" {
		t.Errorf("rw = %v / %s", c.RWRetryOnRateLimit, c.RWCompression)
	}
}

func TestLoadMissingRequired(t *testing.T) {
	os.Unsetenv(EnvNetworkDomainID)
	os.Unsetenv(EnvToken)
	os.Unsetenv(EnvCenterEndpoint)
	if _, err := Load(); err == nil {
		t.Fatal("expected error when required env missing")
	}
}

func TestLoadWithEnv(t *testing.T) {
	t.Setenv(EnvNetworkDomainID, "gov-cloud-a")
	t.Setenv(EnvToken, "tok")
	t.Setenv(EnvCenterEndpoint, "https://10.8.0.5:8443")
	t.Setenv(EnvAgentType, "vmagent")
	t.Setenv(EnvVersion, "v0.2.0")

	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.NetworkDomainID != "gov-cloud-a" || c.Token != "tok" ||
		c.CenterEndpoint != "https://10.8.0.5:8443" {
		t.Fatalf("identity not loaded: %+v", c)
	}
	if c.AgentType != "vmagent" || c.Version != "v0.2.0" {
		t.Fatalf("overrides not applied: %+v", c)
	}
	// 默认值仍生效。
	if c.WalMaxSize != "20GB" {
		t.Fatalf("wal default missing")
	}
}
