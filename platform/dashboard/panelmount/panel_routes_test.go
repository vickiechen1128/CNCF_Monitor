package panelmount_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/dashboard"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

const testPanelURL = "http://1.15.11.216:3000/d/StarsL-TenSunS-node/e4b8bb-e69cba-e79b91-e68ea7?var-interval=5m&from=now-30m&to=now&timezone=browser&var-instance=localhost:9100&var-device=$__all&refresh=1m"

type panelResponse struct {
	Status    string          `json:"status"`
	Data      json.RawMessage `json:"data"`
	ErrorType string          `json:"errorType"`
}

type panelView struct {
	ID   uint   `json:"id"`
	Name string `json:"name"`
	URL  string `json:"url"`
}

func setupPanelRouter(t *testing.T, role string) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dsn := fmt.Sprintf("file:panel_%s?mode=memory&cache=shared", t.Name())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.DashboardPanel{}))

	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(auth.ContextUserKey, &models.User{Role: role, Status: models.UserStatusActive})
		c.Next()
	})
	platform := r.Group("/api/v2/platform")
	admin := platform.Group("")
	admin.Use(auth.RequireAdmin())
	dashboard.RegisterPanelRoutes(platform, admin, db)
	return r
}

func panelRequest(t *testing.T, r http.Handler, method, path string, body any) (int, panelResponse) {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&payload).Encode(body))
	}
	req := httptest.NewRequest(method, path, &payload)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)
	var out panelResponse
	require.NoError(t, json.Unmarshal(res.Body.Bytes(), &out))
	return res.Code, out
}

func TestDashboardPanelCreateListAndGet(t *testing.T) {
	r := setupPanelRouter(t, models.UserRoleAdmin)

	status, created := panelRequest(t, r, http.MethodPost, "/api/v2/platform/dashboard/panels", map[string]string{
		"name": "节点监控大屏",
		"url":  testPanelURL,
	})
	require.Equal(t, http.StatusOK, status)
	require.Equal(t, "success", created.Status)
	var panel panelView
	require.NoError(t, json.Unmarshal(created.Data, &panel))
	require.NotZero(t, panel.ID)
	require.Equal(t, "节点监控大屏", panel.Name)
	require.Equal(t, testPanelURL, panel.URL)

	status, listed := panelRequest(t, r, http.MethodGet, "/api/v2/platform/dashboard/panels", nil)
	require.Equal(t, http.StatusOK, status)
	var list struct {
		List  []panelView `json:"list"`
		Total int64       `json:"total"`
	}
	require.NoError(t, json.Unmarshal(listed.Data, &list))
	require.Len(t, list.List, 1)
	require.Equal(t, int64(1), list.Total)
	require.Equal(t, testPanelURL, list.List[0].URL)

	status, detail := panelRequest(t, r, http.MethodGet, fmt.Sprintf("/api/v2/platform/dashboard/panels/%d", panel.ID), nil)
	require.Equal(t, http.StatusOK, status)
	require.NoError(t, json.Unmarshal(detail.Data, &panel))
	require.Equal(t, "节点监控大屏", panel.Name)
	require.Equal(t, testPanelURL, panel.URL)
}

func TestDashboardPanelValidationAndErrors(t *testing.T) {
	r := setupPanelRouter(t, models.UserRoleAdmin)
	tests := []struct {
		name string
		body map[string]string
	}{
		{name: "empty name", body: map[string]string{"name": " ", "url": testPanelURL}},
		{name: "empty url", body: map[string]string{"name": "节点", "url": ""}},
		{name: "invalid scheme", body: map[string]string{"name": "节点", "url": "javascript:alert(1)"}},
		{name: "missing host", body: map[string]string{"name": "节点", "url": "http:///d/node"}},
		{name: "not dashboard", body: map[string]string{"name": "节点", "url": "https://grafana.example.com/login"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, res := panelRequest(t, r, http.MethodPost, "/api/v2/platform/dashboard/panels", tt.body)
			require.Equal(t, http.StatusBadRequest, status)
			require.Equal(t, "bad_request", res.ErrorType)
		})
	}

	status, res := panelRequest(t, r, http.MethodPost, "/api/v2/platform/dashboard/panels", map[string]string{
		"name": "节点监控大屏", "url": testPanelURL,
	})
	require.Equal(t, http.StatusOK, status)
	status, res = panelRequest(t, r, http.MethodPost, "/api/v2/platform/dashboard/panels", map[string]string{
		"name": "节点监控大屏", "url": testPanelURL,
	})
	require.Equal(t, http.StatusConflict, status)
	require.Equal(t, "conflict", res.ErrorType)

	status, res = panelRequest(t, r, http.MethodGet, "/api/v2/platform/dashboard/panels/999", nil)
	require.Equal(t, http.StatusNotFound, status)
	require.Equal(t, "not_found", res.ErrorType)
}

func TestDashboardPanelCreateRequiresAdmin(t *testing.T) {
	r := setupPanelRouter(t, models.UserRoleUser)
	status, res := panelRequest(t, r, http.MethodPost, "/api/v2/platform/dashboard/panels", map[string]string{
		"name": "节点监控大屏", "url": testPanelURL,
	})
	require.Equal(t, http.StatusForbidden, status)
	require.Equal(t, "forbidden", res.ErrorType)
}
