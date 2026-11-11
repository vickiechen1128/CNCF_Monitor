package domain

import (
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/foundation/apierror"
)

func TestGenerateDomainID(t *testing.T) {
	id, err := GenerateDomainID("mc", "demo")
	require.NoError(t, err)
	assert.Equal(t, "mc-demo", id)

	id, err = GenerateDomainID("mc", "demo-01")
	require.NoError(t, err)
	assert.Equal(t, "mc-demo-01", id)

	invalid := []struct {
		deployCode string
		domainCode string
		field      string
	}{
		{"mc", "", "domain_code"},
		{"mc", "default", "domain_code"},
		{"mc", "Demo", "domain_code"},
		{"mc", "-demo", "domain_code"},
		{"mc", "demo-", "domain_code"},
		{"mc", "demo_01", "domain_code"},
		{"MC", "demo", "deploy_code"},
		{"", "demo", "deploy_code"},
	}
	for _, tc := range invalid {
		_, err := GenerateDomainID(tc.deployCode, tc.domainCode)
		require.Error(t, err, "%q/%q", tc.deployCode, tc.domainCode)
		var validation *ValidationError
		require.ErrorAs(t, err, &validation)
		assert.Equal(t, tc.field, validation.Field, "%q/%q", tc.deployCode, tc.domainCode)
	}
}

func TestRandomDomainCode(t *testing.T) {
	pattern := regexp.MustCompile(`^[0-9a-f]{8}$`)
	for i := 0; i < 8; i++ {
		code, err := RandomDomainCode()
		require.NoError(t, err)
		assert.Regexp(t, pattern, code)
	}
}

func TestParseDomainType(t *testing.T) {
	parsed, err := ParseDomainType("")
	require.NoError(t, err)
	assert.Nil(t, parsed)

	parsed, err = ParseDomainType(" edge ")
	require.NoError(t, err)
	require.NotNil(t, parsed)
	assert.Equal(t, DomainTypeEdge, *parsed)

	parsed, err = ParseDomainType("collection")
	require.NoError(t, err)
	require.NotNil(t, parsed)
	assert.Equal(t, DomainTypeCollection, *parsed)

	for _, raw := range []string{"management", "local", "EDGE"} {
		_, err := ParseDomainType(raw)
		require.Error(t, err, raw)
		assert.Equal(t, apierror.BadRequest, apierror.KindOf(err))
	}
}

func TestParseDomainStatus(t *testing.T) {
	status, err := ParseDomainStatus("")
	require.NoError(t, err)
	assert.Empty(t, status)

	status, err = ParseDomainStatus(" enabled ")
	require.NoError(t, err)
	assert.Equal(t, DomainStatusEnabled, status)

	status, err = ParseDomainStatus("disabled")
	require.NoError(t, err)
	assert.Equal(t, DomainStatusDisabled, status)

	_, err = ParseDomainStatus("management")
	require.Error(t, err)
	assert.Equal(t, apierror.BadRequest, apierror.KindOf(err))
}

func TestDomainInUseError(t *testing.T) {
	err := &DomainInUseError{DomainID: "mc-demo"}
	assert.Equal(t, apierror.Conflict, apierror.KindOf(err))
	assert.Contains(t, err.Error(), "mc-demo")

	err = &DomainInUseError{
		DomainID: "mc-demo",
		Impact: &Impact{
			ResourceCount: 2,
			SampleResources: []ResourceSummary{
				{ResourceID: "res-1"},
				{ResourceID: "res-2"},
			},
		},
	}
	assert.Equal(t, apierror.Conflict, apierror.KindOf(err))
	message := err.Error()
	assert.True(t, strings.Contains(message, "2 resource"))
	assert.Contains(t, message, "res-1")
	assert.Contains(t, message, "migrate or delete")
}

func TestNetworkDomainNotFoundError(t *testing.T) {
	err := &NetworkDomainNotFoundError{DomainID: "mc-missing"}
	assert.Equal(t, apierror.NotFound, apierror.KindOf(err))
	assert.Contains(t, err.Error(), "mc-missing")
}
