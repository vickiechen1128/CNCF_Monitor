package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

func TestMonitorTypesForCategory(t *testing.T) {
	cases := []struct {
		name     string
		category domain.ResourceCategory
		want     []string
	}{
		{"host", domain.CategoryHost, []string{domain.MonitorTypeHostLinux, domain.MonitorTypeHostWindows, domain.MonitorTypeHostNPU}},
		{"database", domain.CategoryDatabase, []string{domain.MonitorTypeMySQL, domain.MonitorTypeRedis}},
		{"middleware", domain.CategoryMiddleware, []string{domain.MonitorTypeKafka, domain.MonitorTypeElasticsearch, domain.MonitorTypeNginx}},
		{"application", domain.CategoryApplication, []string{domain.MonitorTypeApplicationHTTP}},
		{"generic target", domain.CategoryGenericTarget, []string{domain.MonitorTypeSNMP}},
		{"interface service has no monitor type", domain.CategoryInterfaceService, nil},
		{"empty category", "", nil},
		{"unknown category", "unknown", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, domain.MonitorTypesForCategory(tc.category))
		})
	}
}
