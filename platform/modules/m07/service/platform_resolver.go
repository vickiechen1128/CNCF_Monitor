package service

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
)

// resolvePlatformFor normalizes the platform ownership of a resource (D43):
//
//   - composed resources (application / interface_service) always derive their
//     platform from the owning app's primary platform — an explicitly supplied
//     value is ignored so a hand-typed platform can never contradict the app
//     ownership (their app_code is mandatory, and each app has exactly one
//     primary platform, so the derivation is unambiguous);
//   - static resources (host / database / middleware / generic_target) keep an
//     explicit platform_code and only fall back to the app's primary platform
//     when it is blank, because their app ownership may be empty or shared.
//
// A composed resource whose app has no primary platform cannot be resolved;
// D42 makes that state unreachable for newly registered apps, so it is logged
// as an observability signal instead of silently leaving the label empty.
func resolvePlatformFor(ctx context.Context, resolver DictionaryResolver, resource *domain.Resource) error {
	if resource == nil {
		return nil
	}
	appCode := strings.TrimSpace(resource.AppCode)

	if resource.Category.IsComposed() {
		if appCode == "" {
			return nil
		}
		platform, ok, err := resolver.PrimaryPlatformOfApp(ctx, appCode)
		if err != nil {
			return fmt.Errorf("resolve primary platform for %q: %w", appCode, err)
		}
		if !ok {
			log.Printf(
				"m07: composed resource %s (category=%s) app %q has no primary platform; platform label will be empty",
				resource.ResourceID, resource.Category, appCode,
			)
			resource.PlatformCode = ""
			return nil
		}
		resource.PlatformCode = platform
		return nil
	}

	if strings.TrimSpace(resource.PlatformCode) != "" || appCode == "" {
		return nil
	}
	platform, ok, err := resolver.PrimaryPlatformOfApp(ctx, appCode)
	if err != nil {
		return fmt.Errorf("resolve primary platform for %q: %w", appCode, err)
	}
	if ok {
		resource.PlatformCode = platform
	}
	return nil
}
