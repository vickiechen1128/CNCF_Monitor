package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// 生效端口来源必须与端口数值同源（同一解析链），否则 UI 会「端口显示 X、来源说 Y」。
func TestResolvePortWithSource(t *testing.T) {
	host := domain.ResourceRef{ID: "h", Category: domain.CategoryHost}
	db := domain.ResourceRef{ID: "d", Category: domain.CategoryDatabase, Port: 3306}

	cases := []struct {
		name         string
		ref          domain.ResourceRef
		mappingPort  int
		exporterPort int
		wantPort     int
		wantSource   string
	}{
		{"host instance override", domain.ResourceRef{Category: domain.CategoryHost, ScrapePort: 9101}, 9100, 9100, 9101, domain.PortSourceInstance},
		{"host mapping default", host, 9100, 9200, 9100, domain.PortSourceMapping},
		{"host template default", host, 0, 9200, 9200, domain.PortSourceTemplate},
		{"host system default", host, 0, 0, 9100, domain.PortSourceDefault},
		{"db instance override", domain.ResourceRef{Category: domain.CategoryDatabase, ScrapePort: 9104, Port: 3306}, 0, 0, 9104, domain.PortSourceInstance},
		{"db mapping default", db, 9104, 0, 9104, domain.PortSourceMapping},
		{"db business fallback", db, 0, 0, 3306, domain.PortSourceBusiness},
		{"db unresolved", domain.ResourceRef{Category: domain.CategoryDatabase}, 0, 0, 0, domain.PortSourceUnresolved},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			port, source := domain.ResolvePortWithSource(tc.ref, tc.mappingPort, tc.exporterPort)
			assert.Equal(t, tc.wantPort, port)
			assert.Equal(t, tc.wantSource, source)
		})
	}
}
