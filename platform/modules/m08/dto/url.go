package dto

import (
	"net/url"
	"strings"
)

func parseURL(raw string) (*url.URL, error) { return url.Parse(strings.TrimSpace(raw)) }

// firstSegment returns the first non-empty path segment prefixed with "/".
func firstSegment(path string) string {
	for _, segment := range strings.Split(path, "/") {
		if segment != "" {
			return "/" + segment
		}
	}
	return ""
}
