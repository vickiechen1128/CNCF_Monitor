package edge

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/models"
)

var edgeTestDBSeq int64

// newEdgeTestDB 打开 per-test 隔离内存 DB 并迁移 edge 协议所需模型。
// 用唯一 DSN（cache=shared + 序号）避免多个测试共享同一内存库导致数据串扰。
func newEdgeTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&edgeTestDBSeq, 1)
	dsn := fmt.Sprintf("file:edge_test_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	for _, m := range []interface{}{
		&models.NetworkDomain{},
		&models.EdgeAgent{},
		&models.EdgeHeartbeat{},
		&models.ConfigVersion{},
	} {
		require.NoError(t, db.AutoMigrate(m))
	}
	return db
}

func seedEdgeDomain(db *gorm.DB, id, channel, token, agentType, endpoint string) *models.NetworkDomain {
	dom := &models.NetworkDomain{
		ID:                 id,
		Name:               "nd-" + id,
		DomainType:         models.DomainTypeEdge,
		Channel:            models.ChannelType(channel),
		Token:              token,
		AgentType:          models.AgentType(agentType),
		CenterEndpoint:     endpoint,
		TenantID:           "tenant-1",
		Status:             models.DomainStatusEnabled,
		RegistrationStatus: models.RegistrationStatusMonitored,
	}
	_ = db.Create(dom).Error
	return dom
}

func seedConfigVersion(db *gorm.DB, domainID, promYML, rulesYML, blackboxYML string, targets map[string]string, createdAt time.Time) *models.ConfigVersion {
	tj, _ := json.Marshal(targets)
	v := &models.ConfigVersion{
		NetworkDomainID: domainID,
		PrometheusYml:   promYML,
		RulesYml:        rulesYML,
		BlackboxYml:     blackboxYML,
		TargetsFiles:    string(tj),
	}
	v.CreatedAt = createdAt
	_ = db.Create(v).Error
	return v
}

func newEdgeRouter(db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	grp := r.Group("/api/v2/platform/edge")
	RegisterRoutes(grp, db)
	return r
}

// --- T11-04 service 级：config_changed 判定 / 自动注册 / 下载地址合成 ---

func TestHeartbeatConfigChanged_DownloadURL_AndAutoRegister(t *testing.T) {
	db := newEdgeTestDB(t)
	dom := seedEdgeDomain(db, "gov-cloud-a", "agent_pull", "tok-abc", "vmagent", "http://center:8080")

	seedConfigVersion(db, dom.ID,
		"global:\n  scrape_interval: 15s\n",
		"groups: []\n", "",
		map[string]string{"node.json": `[{"targets":["10.0.1.10:9100"]}]`},
		time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC))

	svc := NewHeartbeatService(db)

	// 上报版本与中心一致 → config_changed=false，并自动注册 EdgeAgent。
	req := &HeartbeatRequest{
		NetworkDomainID:      dom.ID,
		AgentType:            models.AgentTypeVMAgent,
		Version:              "v1.2.0",
		ConfigVersion:        "20260724-120000",
		QueueBacklogBytes:    2048,
		RemoteWriteQueueSize: 64,
		Hostname:             "edge01",
		Ip:                   "10.0.2.15",
		Components:           []models.EdgeComponent{{Type: models.ComponentTypeCollector, Name: "vmagent", Status: models.ComponentStatusRunning}},
	}
	resp, err := svc.Handle(dom, req, time.Date(2026, 9, 18, 8, 0, 0, 0, time.UTC))
	require.NoError(t, err)
	assert.False(t, resp.ConfigChanged, "版本一致应 config_changed=false")
	assert.Equal(t, "20260724-120000", resp.ConfigVersion)
	assert.Equal(t, "http://center:8080/api/v2/platform/edge/config?network_domain="+dom.ID, resp.ConfigDownloadURL, "下载地址应为绝对地址")

	var agent models.EdgeAgent
	require.NoError(t, db.Where("network_domain_id = ?", dom.ID).First(&agent).Error)
	assert.Equal(t, models.AgentTypeVMAgent, agent.AgentType, "缺失实例应自动注册")
	assert.Equal(t, "edge01", agent.Hostname)
	assert.Len(t, agent.Components, 1)
	assert.Equal(t, models.ConfigSyncStatusInSync, agent.ConfigSyncStatus)

	// 上报版本过旧 → config_changed=true，out_of_sync_cause=pull_pending。
	req2 := &HeartbeatRequest{NetworkDomainID: dom.ID, ConfigVersion: "20260723-090000"}
	resp2, err := svc.Handle(dom, req2, time.Date(2026, 9, 18, 8, 1, 0, 0, time.UTC))
	require.NoError(t, err)
	assert.True(t, resp2.ConfigChanged, "版本不一致应 config_changed=true")
	assert.Equal(t, "20260724-120000", resp2.ConfigVersion)

	require.NoError(t, db.Where("network_domain_id = ?", dom.ID).First(&agent).Error)
	assert.Equal(t, models.ConfigSyncStatusOutOfSync, agent.ConfigSyncStatus)
	assert.Equal(t, models.OutOfSyncCausePullPending, agent.OutOfSyncCause)
}

func TestHeartbeatService_NoConfigVersion(t *testing.T) {
	db := newEdgeTestDB(t)
	dom := seedEdgeDomain(db, "nd-empty", "agent_pull", "tok-xyz", "", "http://center:8080")
	svc := NewHeartbeatService(db)
	resp, err := svc.Handle(dom, &HeartbeatRequest{NetworkDomainID: dom.ID, ConfigVersion: ""}, time.Now())
	require.NoError(t, err)
	assert.False(t, resp.ConfigChanged)
	assert.Empty(t, resp.ConfigVersion)
}

// --- T11-04/T11-03 handler 级：token 鉴定 / 网域缺失 / local 拒绝 ---

func TestHeartbeatUnauthorizedMissingIdentity(t *testing.T) {
	db := newEdgeTestDB(t)
	seedEdgeDomain(db, "gov-x", "agent_pull", "tok-x", "vmagent", "")
	r := newEdgeRouter(db)

	// 缺 token。
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/v2/platform/edge/heartbeat",
		strings.NewReader(`{"network_domain_id":"gov-x","config_version":"x"}`)))
	assert.Equal(t, http.StatusUnauthorized, w.Code)

	// token 不匹配。
	w2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/api/v2/platform/edge/heartbeat",
		strings.NewReader(`{"network_domain_id":"gov-x","config_version":"x"}`))
	req2.Header.Set("Authorization", "Bearer wrong-token")
	r.ServeHTTP(w2, req2)
	assert.Equal(t, http.StatusUnauthorized, w2.Code)
}

func TestHeartbeatLocalDomainRejected(t *testing.T) {
	db := newEdgeTestDB(t)
	seedEdgeDomain(db, "default", "local", "tok-local", "", "")
	r := newEdgeRouter(db)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v2/platform/edge/heartbeat",
		strings.NewReader(`{"network_domain_id":"default","config_version":"x"}`))
	req.Header.Set("Authorization", "Bearer tok-local")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusConflict, w.Code, "local 通道网域不走 edge 协议 → 409")
}

// --- T11-05 config zip：5 结构 + checksum 可复算 ---

func TestBuildConfigZipStructureAndChecksumRecomputable(t *testing.T) {
	db := newEdgeTestDB(t)
	promYML := "global:\n  scrape_interval: 15s\nscrape_configs:\n  - job_name: node\n"
	rulesYML := "groups:\n  - name: x\n    rules: []\n"
	blackboxYML := "modules:\n  http_2xx:\n    prober: http\n"
	targets := map[string]string{
		"node.json": `[{"targets":["10.0.1.10:9100"],"labels":{"job":"node"}}]`,
		"http.json": `[{"targets":["https://api.example.com/health"]}]`,
	}
	v := seedConfigVersion(db, "gov-a", promYML, rulesYML, blackboxYML, targets,
		time.Date(2026, 7, 24, 12, 15, 0, 0, time.UTC))

	zipData, checksum, err := BuildConfigZip(v, models.AgentTypeVMAgent, "")
	require.NoError(t, err)
	require.NotEmpty(t, checksum)

	// 应包含 5 类条目。
	zr, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	require.NoError(t, err)
	names := map[string]bool{}
	for _, f := range zr.File {
		names[f.Name] = true
	}
	assert.True(t, names["prometheus.yml"], "应含 prometheus.yml")
	assert.True(t, names["targets/node.json"], "应含 targets/node.json")
	assert.True(t, names["targets/http.json"], "应含 targets/http.json")
	assert.True(t, names["blackbox.yml"], "应含 blackbox.yml")
	assert.True(t, names["rules.yml"], "应含 rules.yml")
	assert.True(t, names["metadata.json"], "应含 metadata.json")
	assert.Equal(t, 6, len(zr.File))

	// metadata.json 校验字段。
	var meta metadata
	for _, f := range zr.File {
		if f.Name == "metadata.json" {
			rc, _ := f.Open()
			require.NoError(t, json.NewDecoder(rc).Decode(&meta))
			_ = rc.Close()
		}
	}
	assert.Equal(t, "20260724-121500", meta.ConfigVersion)
	assert.Equal(t, "vmagent", meta.AgentType)
	assert.Equal(t, checksum, meta.Checksum)

	// 联合 checksum 可复算一致。
	recomputed := packageChecksum(promYML, rulesYML, blackboxYML, targetsCarrier(targets))
	assert.Equal(t, checksum, recomputed, "checksum 应可复算一致")
}

func TestBuildConfigZipOptionalEntries(t *testing.T) {
	db := newEdgeTestDB(t)
	// 无 rules/blackbox 时不应生成对应条目。
	v := seedConfigVersion(db, "gov-b",
		"global:\n  scrape_interval: 15s\n", "", "",
		map[string]string{"node.json": `[{"targets":["10.0.1.10:9100"]}]`},
		time.Date(2026, 7, 24, 10, 0, 0, 0, time.UTC))
	zipData, _, err := BuildConfigZip(v, models.AgentTypeVMAgent, "")
	require.NoError(t, err)
	zr, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	require.NoError(t, err)
	names := map[string]bool{}
	for _, f := range zr.File {
		names[f.Name] = true
	}
	assert.False(t, names["rules.yml"], "无 rules 不应生成 rules.yml")
	assert.False(t, names["blackbox.yml"], "无 blackbox 不应生成 blackbox.yml")
	assert.True(t, names["prometheus.yml"])
	assert.True(t, names["targets/node.json"])
	assert.True(t, names["metadata.json"])
}

// TestBuildConfigZipRemoteWriteURL 断言 metadata.json 承载 remote_write_url：
// 网域显式配置时下发（T11-G1-02 方案 B），未配置时省略（omitempty）。
func TestBuildConfigZipRemoteWriteURL(t *testing.T) {
	db := newEdgeTestDB(t)
	seed := func(domainID string) *models.ConfigVersion {
		return seedConfigVersion(db, domainID, "global:\n  scrape_interval: 15s\n", "", "",
			map[string]string{"node.json": `[{"targets":["10.0.1.10:9100"]}]`},
			time.Date(2026, 7, 24, 12, 15, 0, 0, time.UTC))
	}

	readMeta := func(zipData []byte) metadata {
		zr, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
		require.NoError(t, err)
		var m metadata
		for _, f := range zr.File {
			if f.Name == "metadata.json" {
				rc, _ := f.Open()
				require.NoError(t, json.NewDecoder(rc).Decode(&m))
				_ = rc.Close()
			}
		}
		return m
	}

	// 显式配置 RemoteWriteURL → metadata 下发该地址。
	with := seed("gov-rw-with")
	zipWith, _, err := BuildConfigZip(with, models.AgentTypeVMAgent, "http://10.0.0.1:8428/api/v1/write")
	require.NoError(t, err)
	assert.Equal(t, "http://10.0.0.1:8428/api/v1/write", readMeta(zipWith).RemoteWriteURL)

	// 未配置（空串）→ metadata 省略该字段。
	without := seed("gov-rw-without")
	zipWithout, _, err := BuildConfigZip(without, models.AgentTypeVMAgent, "")
	require.NoError(t, err)
	assert.Empty(t, readMeta(zipWithout).RemoteWriteURL, "未显式配置应省略 remote_write_url")

	// 下发地址不影响联合 checksum 可复算（metadata 自身不计入 checksum）。
	recomputed := packageChecksum(with.PrometheusYml, with.RulesYml, with.BlackboxYml, targetsCarrier(map[string]string{"node.json": `[{"targets":["10.0.1.10:9100"]}]`}))
	_, checksum, _ := BuildConfigZip(with, models.AgentTypeVMAgent, "http://10.0.0.1:8428/api/v1/write")
	assert.Equal(t, recomputed, checksum, "remote_write_url 不应影响联合 checksum")
}

// --- T11-05 config handler：zip 200 / 304 / 404 / 401 ---

func TestConfigHandlerServeZipAnd304(t *testing.T) {
	db := newEdgeTestDB(t)
	dom := seedEdgeDomain(db, "gov-c", "agent_pull", "tok-c", "vmagent", "http://center:8080")
	seedConfigVersion(db, dom.ID, "global:\n  scrape_interval: 15s\n", "", "",
		map[string]string{"node.json": `[{"targets":["10.0.1.10:9100"]}]`},
		time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC))
	r := newEdgeRouter(db)

	// 初始拉取（无 config_version）→ 200 zip。
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet,
		"/api/v2/platform/edge/config?network_domain="+dom.ID, nil)
	req.Header.Set("Authorization", "Bearer tok-c")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "application/zip", w.Header().Get("Content-Type"))
	assert.Equal(t, fmt.Sprintf(`attachment; filename="edge-config-%s.zip"`, dom.ID), w.Header().Get("Content-Disposition"))
	// 携带匹配 ETag 再拉 → 304。
	etag := w.Header().Get("ETag")
	assert.NotEmpty(t, etag)

	w2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodGet,
		"/api/v2/platform/edge/config?network_domain="+dom.ID+"&config_version=20260724-120000", nil)
	req2.Header.Set("Authorization", "Bearer tok-c")
	r.ServeHTTP(w2, req2)
	assert.Equal(t, http.StatusNotModified, w2.Code, "版本一致应 304")

	// 通过 If-None-Match 也 304。
	w3 := httptest.NewRecorder()
	req3 := httptest.NewRequest(http.MethodGet,
		"/api/v2/platform/edge/config?network_domain="+dom.ID, nil)
	req3.Header.Set("Authorization", "Bearer tok-c")
	req3.Header.Set("If-None-Match", etag)
	r.ServeHTTP(w3, req3)
	assert.Equal(t, http.StatusNotModified, w3.Code)

	_ = etag
}

func TestConfigHandlerNoVersionNotFound(t *testing.T) {
	db := newEdgeTestDB(t)
	dom := seedEdgeDomain(db, "gov-empty", "agent_pull", "tok-e", "", "")
	r := newEdgeRouter(db)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet,
		"/api/v2/platform/edge/config?network_domain="+dom.ID, nil)
	req.Header.Set("Authorization", "Bearer tok-e")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusNotFound, w.Code, "尚无配置版本应 404")
}
