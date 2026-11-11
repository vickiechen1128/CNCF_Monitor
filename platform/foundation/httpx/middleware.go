// Package httpx provides small, shared Gin middleware for the v3 HTTP surface.
package httpx

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"time"

	"github.com/gin-gonic/gin"
)

// HeaderRequestID is the request correlation header.
const HeaderRequestID = "X-Request-ID"

// contextRequestID is the gin context key holding the request id.
const contextRequestID = "requestID"

// RequestID propagates or generates a request id, stores it in the context and
// echoes it in the response header. Incoming ids with control characters are
// discarded to prevent log injection.
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader(HeaderRequestID)
		if !validRequestID(id) {
			id = newRequestID()
		}
		c.Set(contextRequestID, id)
		c.Header(HeaderRequestID, id)
		c.Next()
	}
}

// RequestIDFrom returns the request id stored by RequestID.
func RequestIDFrom(c *gin.Context) string {
	if c == nil {
		return ""
	}
	if v, ok := c.Get(contextRequestID); ok {
		if id, ok := v.(string); ok {
			return id
		}
	}
	return ""
}

// AccessLog writes one access log line per request. It must run after
// RequestID and Recovery so failed requests still produce a line with the
// final status.
func AccessLog(logger *log.Logger) gin.HandlerFunc {
	if logger == nil {
		logger = log.Default()
	}
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		logger.Printf(
			"http access method=%s path=%q status=%d duration_ms=%d request_id=%s client_ip=%s",
			c.Request.Method,
			c.Request.URL.Path,
			c.Writer.Status(),
			time.Since(start).Milliseconds(),
			RequestIDFrom(c),
			c.ClientIP(),
		)
	}
}

func newRequestID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return time.Now().UTC().Format("20060102150405.000000000")
	}
	return hex.EncodeToString(b)
}

func validRequestID(id string) bool {
	if id == "" || len(id) > 128 {
		return false
	}
	for i := 0; i < len(id); i++ {
		if id[i] < 0x20 || id[i] > 0x7e {
			return false
		}
	}
	return true
}
