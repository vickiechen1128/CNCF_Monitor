package networkdomain

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestReadDeployCodeDefault(t *testing.T) {
	t.Setenv("METRIC_CENTER_DEPLOY_CODE", "")
	assert.Equal(t, "mc", ReadDeployCode())
}

func TestReadDeployCodeFromEnv(t *testing.T) {
	t.Setenv("METRIC_CENTER_DEPLOY_CODE", "gov")
	assert.Equal(t, "gov", ReadDeployCode())
}

func TestGenerateDomainIDDefaultPrefix(t *testing.T) {
	id, err := GenerateDomainID("mc", "zhw-a")
	require.NoError(t, err)
	assert.Equal(t, "mc-zhw-a", id)
}

func TestGenerateDomainIDEscapesPrefix(t *testing.T) {
	id, err := GenerateDomainID("gov", "hos-02")
	require.NoError(t, err)
	assert.Equal(t, "gov-hos-02", id)
}

func TestGenerateDomainIDDefaultSpecialCase(t *testing.T) {
	id, err := GenerateDomainID("mc", models.DefaultDomainID)
	require.NoError(t, err)
	assert.Equal(t, models.DefaultDomainID, id)
}

func TestGenerateDomainIDInvalidDomainCode(t *testing.T) {
	for _, dc := range []string{"", "Bad", "a_b", "a b", "-abc", "abc-", "A1", "a-b-c."} {
		_, err := GenerateDomainID("mc", dc)
		assert.Error(t, err, "domainCode=%q should fail", dc)
	}
}

func TestGenerateDomainIDInvalidDeployCode(t *testing.T) {
	for _, dp := range []string{"", "Gov", "deploy_1", "a b"} {
		_, err := GenerateDomainID(dp, "zhw-a")
		assert.Error(t, err, "deployCode=%q should fail", dp)
	}
}
