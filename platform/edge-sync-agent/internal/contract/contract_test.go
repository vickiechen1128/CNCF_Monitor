package contract

import (
	"encoding/json"
	"testing"
)

func TestHeartbeatRequestJSONRoundTrip(t *testing.T) {
	req := HeartbeatRequest{
		NetworkDomainID:      "gov-cloud-a",
		AgentType:            "vmagent",
		Version:              "v1.2.0",
		ConfigVersion:        "20260724-120000",
		QueueBacklogBytes:    1048576,
		RemoteWriteQueueSize: 120,
		Hostname:             "edge01",
		Ip:                   "10.0.2.15",
		Components: []Component{
			{Type: "collector", Name: "vmagent", Status: "restarting", Version: "v1.101.0", RestartCount: 3},
		},
	}
	b, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	// 必须使用与 PRD §6.2 一致的字段名。
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"network_domain_id", "agent_type", "version", "config_version",
		"queue_backlog_bytes", "remote_write_queue_size", "hostname", "ip", "components"} {
		if _, ok := m[k]; !ok {
			t.Errorf("missing json field %q (contract drift)", k)
		}
	}

	var back HeartbeatRequest
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatal(err)
	}
	if back.NetworkDomainID != "gov-cloud-a" || back.ConfigVersion != "20260724-120000" {
		t.Fatalf("round-trip mismatch: %+v", back)
	}
	if back.QueueBacklogBytes != 1048576 {
		t.Fatalf("queue_backlog_bytes round-trip mismatch: %d", back.QueueBacklogBytes)
	}
}

func TestHeartbeatResponseJSON(t *testing.T) {
	var resp HeartbeatResponse
	err := json.Unmarshal([]byte(`{
		"config_changed": true,
		"config_version": "20260724-121500",
		"config_download_url": "https://10.8.0.5:8443/api/v2/platform/edge/config?network_domain=gov-cloud-a"
	}`), &resp)
	if err != nil {
		t.Fatal(err)
	}
	if !resp.ConfigChanged || resp.ConfigVersion != "20260724-121500" ||
		resp.ConfigDownloadURL == "" {
		t.Fatalf("unexpected %+v", resp)
	}
}

func TestMetadataJSONAlignsCenter(t *testing.T) {
	// 字段必须与中心 zipper.go 一致：config_version/generated_at/agent_type/checksum。
	var m Metadata
	err := json.Unmarshal([]byte(`{
		"config_version":"20260724-120000",
		"generated_at":"2026-09-17T12:00:00Z",
		"agent_type":"vmagent",
		"checksum":"abcd"
	}`), &m)
	if err != nil {
		t.Fatal(err)
	}
	if m.Checksum != "abcd" || m.AgentType != "vmagent" || m.ConfigVersion != "20260724-120000" {
		t.Fatalf("unexpected %+v", m)
	}
}

func TestPathConstants(t *testing.T) {
	if HeartbeatPath != "/api/v2/platform/edge/heartbeat" {
		t.Fatalf("heartbeat path drift: %s", HeartbeatPath)
	}
	if ConfigPath != "/api/v2/platform/edge/config" {
		t.Fatalf("config path drift: %s", ConfigPath)
	}
}
