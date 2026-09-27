package contract

import (
	"encoding/json"
	"strings"
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

// TestEdgeTargetSnapshotJSONTag 校验 EdgeTargetSnapshot 的字段与 snake_case json tag
// 严格对齐中心侧契约：job/instance/resource_id/health/last_scrape/last_error/
// scrape_duration_seconds（方案 B 上报 vmagent 本地 target 快照）。
func TestEdgeTargetSnapshotJSONTag(t *testing.T) {
	target := EdgeTargetSnapshot{
		Job:                   "node",
		Instance:              "10.0.0.1:9100",
		ResourceID:            "resource-1",
		Health:                "up",
		LastScrape:            "2026-09-18T12:00:00Z",
		LastError:             "context deadline exceeded",
		ScrapeDurationSeconds: 12.345,
	}
	b, err := json.Marshal(target)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"job", "instance", "resource_id", "health",
		"last_scrape", "last_error", "scrape_duration_seconds"} {
		if _, ok := m[k]; !ok {
			t.Errorf("missing json field %q (contract drift)", k)
		}
	}
	if m["job"] != "node" || m["health"] != "up" || m["instance"] != "10.0.0.1:9100" {
		t.Fatalf("unexpected json values: %+v", m)
	}
	if m["scrape_duration_seconds"] != 12.345 {
		t.Fatalf("scrape_duration_seconds = %v", m["scrape_duration_seconds"])
	}
	// omitempty 语义：空值字段应缺省（resource_id / last_error / last_scrape / duration 空时）。
	sparse := EdgeTargetSnapshot{Job: "job", Instance: "inst", Health: "down"}
	bs, err := json.Marshal(sparse)
	if err != nil {
		t.Fatal(err)
	}
	var ms map[string]any
	if err := json.Unmarshal(bs, &ms); err != nil {
		t.Fatal(err)
	}
	for _, absent := range []string{"resource_id", "last_scrape", "last_error", "scrape_duration_seconds"} {
		if _, ok := ms[absent]; ok {
			t.Errorf("field %q should be omitted when empty (omitempty drift)", absent)
		}
	}
}

// TestHeartbeatRequestJSONCarriesTargets 校验 HeartbeatRequest 携带 targets 快照字段，
// 与既有字段序列化并存（两端对齐）。
func TestHeartbeatRequestJSONCarriesTargets(t *testing.T) {
	req := HeartbeatRequest{
		NetworkDomainID: "gov-cloud-a",
		AgentType:       "vmagent",
		Hostname:        "edge01",
		Targets: []EdgeTargetSnapshot{
			{Job: "node", Instance: "10.0.0.1:9100", Health: "up", ScrapeDurationSeconds: 0.01},
		},
	}
	b, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	targets, ok := m["targets"].([]any)
	if !ok || len(targets) != 1 {
		t.Fatalf("targets field missing/wrong: %+v", m["targets"])
	}
	first, ok := targets[0].(map[string]any)
	if !ok || first["job"] != "node" || first["health"] != "up" {
		t.Fatalf("targets[0] = %+v", targets[0])
	}
	// 缺省为空时 targets 应整个省略（omitempty）。
	empty := HeartbeatRequest{NetworkDomainID: "gov-cloud-a", AgentType: "vmagent"}
	be, err := json.Marshal(empty)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(be), "targets") {
		t.Fatalf("empty targets should be omitted: %s", be)
	}
}

// TestHeartbeatRequestJSONCarriesApplyError 校验 D-1 新增的配置应用结果字段（M11
// dev-feedback F-17 / 设计提案 D）：字段名与中心契约同名同义，空值 omitempty 不产出键。
func TestHeartbeatRequestJSONCarriesApplyError(t *testing.T) {
	req := HeartbeatRequest{
		NetworkDomainID:          "gov-cloud-a",
		AgentType:                "vmagent",
		ConfigVersion:            "20260922-091425",
		ConfigApplyError:         "deployer: targets app.json: empty array",
		ConfigApplyFailedVersion: "20260924-101010",
	}
	b, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	if m["config_apply_error"] != req.ConfigApplyError {
		t.Fatalf("config_apply_error = %v", m["config_apply_error"])
	}
	if m["config_apply_failed_version"] != req.ConfigApplyFailedVersion {
		t.Fatalf("config_apply_failed_version = %v", m["config_apply_failed_version"])
	}
	// round-trip
	var back HeartbeatRequest
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatal(err)
	}
	if back.ConfigApplyError != req.ConfigApplyError || back.ConfigApplyFailedVersion != req.ConfigApplyFailedVersion {
		t.Fatalf("round-trip mismatch: %+v", back)
	}
	// 空值 omitempty：应用成功时不上报这两个键。
	empty := HeartbeatRequest{NetworkDomainID: "gov-cloud-a", AgentType: "vmagent"}
	be, err := json.Marshal(empty)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(be), "config_apply_error") || strings.Contains(string(be), "config_apply_failed_version") {
		t.Fatalf("empty apply result should be omitted: %s", be)
	}
}
