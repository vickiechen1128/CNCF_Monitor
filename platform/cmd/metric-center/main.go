// metric-center 是 MetricCenter 控制面的主程序入口。
//
// MVP 阶段提供：
//   - 健康检查接口
//   - 配置管理 API 占位
//   - Prometheus Query API 代理
//
// 后续逐步接入 CMDB、标签模板、采集模板、配置下发等业务模块。
package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"
)

var (
	listenAddr    = flag.String("listen-address", ":8080", "MetricCenter HTTP 监听地址")
	prometheusURL = flag.String("prometheus.url", "http://localhost:9090", "Prometheus 查询地址")
)

func main() {
	flag.Parse()

	r := gin.Default()

	// 健康检查
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":    "ok",
			"service":   "metric-center",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
	})

	// API v1 路由组
	apiV1 := r.Group("/api/v1")
	{
		// 状态概览
		apiV1.GET("/status", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{
				"version": "0.1.0-mvp",
				"mode":    "mvp",
			})
		})

		// 配置管理占位
		config := apiV1.Group("/config")
		{
			config.GET("/preview", func(c *gin.Context) {
				c.JSON(http.StatusOK, gin.H{
					"prometheus_yml": "# TODO: 根据 CMDB + 标签模板生成\n",
				})
			})
			config.POST("/apply", func(c *gin.Context) {
				c.JSON(http.StatusOK, gin.H{"ok": true, "message": "配置下发接口占位"})
			})
		}

		// Prometheus Query API 代理
		proxy := httputil.NewSingleHostReverseProxy(mustParseURL(*prometheusURL))
		apiV1.Any("/query/*path", func(c *gin.Context) {
			c.Request.URL.Path = c.Param("path")
			proxy.ServeHTTP(c.Writer, c.Request)
		})
	}

	log.Printf(">>> metric-center listening on %s", *listenAddr)
	log.Printf(">>> prometheus proxy target: %s", *prometheusURL)
	if err := r.Run(*listenAddr); err != nil {
		log.Fatalf("failed to start metric-center: %v", err)
	}
}

func mustParseURL(raw string) *url.URL {
	u, err := url.Parse(raw)
	if err != nil {
		panic(fmt.Sprintf("invalid url %q: %v", raw, err))
	}
	return u
}
