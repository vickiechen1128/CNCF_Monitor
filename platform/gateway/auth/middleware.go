package auth

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
)

// ContextUserKey is the gin context key under which AuthMiddleware stores the
// authenticated user (*models.User). Later handlers (e.g. GET /auth/me) can
// read the current user from the request context instead of re-querying.
const ContextUserKey = "authUser"

// healthPaths are the public health endpoints that must remain anonymous.
// 契约 §4「横切约定」：除 POST /api/v2/platform/auth/login 与 /api/v1/health*
// 外，所有 /api/* 请求须携带有效 Bearer token。
var healthPaths = map[string]struct{}{
	"/api/v1/health":    {},
	"/api/v1/health/db": {},
	"/api/v1/status":    {},
}

// AuthMiddleware enforces the contract-wide authentication gate for /api/*
// requests. It only authenticates—never authorizes (no role / permission
// checks). It lets through:
//   - every non-/api/* request (frontend static assets and SPA routes when the
//     control plane hosts the UI itself, see deploy topology A2);
//   - OPTIONS preflight requests;
//   - POST /api/v2/platform/auth/login;
//   - the /api/v1/health*, /api/v1/status public health endpoints.
//
// Every other request must carry an `Authorization: Bearer <token>` header
// resolving to a live, unexpired session of an active user, otherwise a 401
// (errorType=unauthorized) is returned. On success the resolved user is
// stored in the gin context under ContextUserKey.
func AuthMiddleware(svc *Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path
		// 非 /api/* 请求（A2 同源托管的前端静态资源与前端 history 路由）不在本
		// 中间件认证范围内：契约 §4 约束的是 /api/*。若不放行，浏览器加载
		// index.html 与 assets/*.js 会被 401 拦截，页面根本打不开。
		if !strings.HasPrefix(path, "/api/") {
			c.Next()
			return
		}
		if c.Request.Method == http.MethodOptions {
			c.Next()
			return
		}
		if c.Request.Method == http.MethodPost && path == "/api/v2/platform/auth/login" {
			c.Next()
			return
		}
		if _, ok := healthPaths[path]; ok {
			c.Next()
			return
		}

		token := bearerToken(c)
		if token == "" {
			response.Unauthorized(c, ErrUnauthorized.Error())
			c.Abort()
			return
		}
		user, err := svc.Authenticate(token)
		if err != nil {
			response.Unauthorized(c, ErrUnauthorized.Error())
			c.Abort()
			return
		}
		c.Set(ContextUserKey, user)
		c.Next()
	}
}
