package silence

import (
	"fmt"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
)

// AuthorizeMatchers 服务端校验写请求的 matcher 收敛于当前用户授权网域集合
// （决策 56）。MVP 单租户下授权集合恒 AllDomains=true → 直接通过；骨架保留，
// 未来多租户时由调用方从认证上下文构建授权集合作为 scope 传入。
//
// 越权 matcher 返回含越权对象提示的错误（由 handler 映射 bad_request）。
func AuthorizeMatchers(scope *models.AuthorizedMatcherScope, matchers []models.SilenceMatcher) error {
	if scope == nil {
		// 缺省按 MVP 单租户全授权处理（不附加约束）。
		return nil
	}
	violations := scope.Violations(matchers)
	if len(violations) == 0 {
		return nil
	}
	names := make([]string, 0, len(violations))
	for _, m := range violations {
		names = append(names, m.Name+"="+m.Value)
	}
	return fmt.Errorf("silence matcher(s) outside authorized scope: %s", strings.Join(names, ", "))
}

// buildScopeForUser 构建当前用户授权网域集合（决策 56 骨架）。MVP 单租户恒
// AllDomains=true；未来多租户从这里读取用户授权网域集合并序列化为集合。
func buildScopeForUser() *models.AuthorizedMatcherScope {
	return &models.AuthorizedMatcherScope{AllDomains: true}
}