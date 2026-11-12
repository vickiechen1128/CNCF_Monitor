package handler

import (
	"context"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/foundation/apierror"
)

// ContextNetworkDomainKey is the gin context key under which
// EdgeTokenMiddleware stores the resolved network domain ID for downstream
// edge handlers.
const ContextNetworkDomainKey = "m09NetworkDomain"

// TokenValidator resolves an edge bearer token to the owning network domain.
// B4 replaces the default rejectAllValidator with a sha256 lookup against
// network_domain_access.token_hash.
type TokenValidator interface {
	Validate(ctx context.Context, token string) (networkDomainID string, ok bool)
}

// rejectAllValidator is the B2 default: no valid tokens exist yet (the onboarding
// /monitor endpoint lands in B3-2), so every edge request is rejected with 401.
// This keeps the surface safely closed until real validation is wired.
type rejectAllValidator struct{}

func (rejectAllValidator) Validate(context.Context, string) (string, bool) { return "", false }

// EdgeTokenMiddleware authenticates /api/v3/edge/* requests by bearer token.
// Missing or invalid tokens yield 401 (unauthorized). On success the resolved
// network domain ID is stored under ContextNetworkDomainKey.
func EdgeTokenMiddleware(v TokenValidator) gin.HandlerFunc {
	if v == nil {
		v = rejectAllValidator{}
	}
	return func(c *gin.Context) {
		token := bearerToken(c)
		if token == "" {
			respondError(c, apierror.New(apierror.Unauthorized, "missing edge token"))
			c.Abort()
			return
		}
		domainID, ok := v.Validate(c.Request.Context(), token)
		if !ok {
			respondError(c, apierror.New(apierror.Unauthorized, "invalid edge token"))
			c.Abort()
			return
		}
		c.Set(ContextNetworkDomainKey, domainID)
		c.Next()
	}
}

// bearerToken extracts the token from an "Authorization: Bearer <token>" header.
func bearerToken(c *gin.Context) string {
	h := c.GetHeader("Authorization")
	const prefix = "Bearer "
	if !strings.HasPrefix(h, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(h, prefix))
}

// NetworkDomainFromContext returns the network domain ID injected by
// EdgeTokenMiddleware, or "" if absent.
func NetworkDomainFromContext(c *gin.Context) string {
	v, ok := c.Get(ContextNetworkDomainKey)
	if !ok {
		return ""
	}
	id, _ := v.(string)
	return id
}
