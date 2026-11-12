package domain

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/foundation/apierror"
)

func TestGenerateToken(t *testing.T) {
	now := time.Now()
	tok, err := GenerateToken()
	require.NoError(t, err)

	assert.True(t, strings.HasPrefix(tok.Plain, tokenPrefix), "token must carry the mctok_v1_ prefix")
	assert.Len(t, strings.TrimPrefix(tok.Plain, tokenPrefix), tokenRandomBytes*2, "random portion is 32 bytes hex")
	assert.Equal(t, HashToken(tok.Plain), tok.Hash, "hash is sha256 of the plaintext")
	assert.NotContains(t, tok.Hash, tok.Plain, "hash must not embed the plaintext")
	assert.Regexp(t, `^[0-9a-f]{2}\*{4}[0-9a-f]{2}$`, tok.Masked, "mask keeps first/last two chars only")

	other, err := GenerateToken()
	require.NoError(t, err)
	assert.NotEqual(t, tok.Plain, other.Plain, "tokens must be unique")
	assert.True(t, TokenMatches(tok.Plain, tok.Hash))
	assert.False(t, TokenMatches(other.Plain, tok.Hash))
	_ = now
}

func TestTokenMatchesRejectsEmpty(t *testing.T) {
	assert.False(t, TokenMatches("", "abc"))
	assert.False(t, TokenMatches("abc", ""))
}

func TestMonitorTransitions(t *testing.T) {
	now := time.Now()

	t.Run("created to monitored issues a token", func(t *testing.T) {
		a := &Access{DomainID: "mc-demo", RegistrationStatus: RegistrationStatusCreated}
		tok, err := a.Monitor(now)
		require.NoError(t, err)
		assert.Equal(t, RegistrationStatusMonitored, a.RegistrationStatus)
		assert.Equal(t, tok.Hash, a.TokenHash)
		assert.Equal(t, tok.Masked, a.TokenMasked)
		require.NotNil(t, a.MonitoredAt)
		assert.True(t, TokenMatches(tok.Plain, a.TokenHash))
	})

	t.Run("empty status is treated as created", func(t *testing.T) {
		a := &Access{DomainID: "mc-demo"}
		_, err := a.Monitor(now)
		require.NoError(t, err)
		assert.Equal(t, RegistrationStatusMonitored, a.RegistrationStatus)
	})

	t.Run("already monitored is conflict", func(t *testing.T) {
		a := &Access{DomainID: "mc-demo", RegistrationStatus: RegistrationStatusMonitored}
		_, err := a.Monitor(now)
		assert.Equal(t, apierror.Conflict, apierror.KindOf(err))
	})

	t.Run("retired is conflict", func(t *testing.T) {
		a := &Access{DomainID: "mc-demo", RegistrationStatus: RegistrationStatusRetired}
		_, err := a.Monitor(now)
		assert.Equal(t, apierror.Conflict, apierror.KindOf(err))
	})
}

func TestUnmonitor(t *testing.T) {
	t.Run("monitored back to created revokes token", func(t *testing.T) {
		a := &Access{DomainID: "mc-demo", RegistrationStatus: RegistrationStatusMonitored, TokenHash: "h", TokenMasked: "m"}
		now := time.Now()
		a.MonitoredAt = &now
		require.NoError(t, a.Unmonitor())
		assert.Equal(t, RegistrationStatusCreated, a.RegistrationStatus)
		assert.Empty(t, a.TokenHash)
		assert.Empty(t, a.TokenMasked)
		assert.Nil(t, a.TokenCreatedAt)
		assert.Nil(t, a.MonitoredAt)
	})

	t.Run("created is idempotent", func(t *testing.T) {
		a := &Access{DomainID: "mc-demo", RegistrationStatus: RegistrationStatusCreated}
		assert.NoError(t, a.Unmonitor())
		assert.Equal(t, RegistrationStatusCreated, a.RegistrationStatus)
	})

	t.Run("retired is conflict", func(t *testing.T) {
		a := &Access{DomainID: "mc-demo", RegistrationStatus: RegistrationStatusRetired}
		assert.Equal(t, apierror.Conflict, apierror.KindOf(a.Unmonitor()))
	})
}

func TestResetToken(t *testing.T) {
	now := time.Now()

	t.Run("monitored issues a new token", func(t *testing.T) {
		a := &Access{DomainID: "mc-demo", RegistrationStatus: RegistrationStatusMonitored, TokenHash: HashToken("old"), TokenMasked: "old"}
		oldHash := a.TokenHash
		tok, err := a.ResetToken(now)
		require.NoError(t, err)
		assert.NotEqual(t, oldHash, a.TokenHash, "old token must be revoked")
		assert.Equal(t, tok.Hash, a.TokenHash)
		assert.False(t, TokenMatches("old", a.TokenHash))
		assert.True(t, TokenMatches(tok.Plain, a.TokenHash))
	})

	t.Run("non-monitored is conflict", func(t *testing.T) {
		for _, status := range []RegistrationStatus{RegistrationStatusCreated, RegistrationStatusRetired} {
			a := &Access{DomainID: "mc-demo", RegistrationStatus: status}
			_, err := a.ResetToken(now)
			assert.Equal(t, apierror.Conflict, apierror.KindOf(err), "status %s", status)
		}
	})
}

func TestRetire(t *testing.T) {
	a := &Access{DomainID: "mc-demo", RegistrationStatus: RegistrationStatusMonitored, TokenHash: "h", TokenMasked: "m"}
	a.Retire()
	assert.Equal(t, RegistrationStatusRetired, a.RegistrationStatus)
	assert.Empty(t, a.TokenHash)
	assert.Empty(t, a.TokenMasked)
	assert.Nil(t, a.MonitoredAt)

	// idempotent
	a.Retire()
	assert.Equal(t, RegistrationStatusRetired, a.RegistrationStatus)
}

func TestValidateMonitorable(t *testing.T) {
	assert.NoError(t, ValidateMonitorable("mc-demo", "enabled", "edge"))
	assert.Equal(t, apierror.BadRequest, apierror.KindOf(ValidateMonitorable("mc-demo", "disabled", "edge")))
	assert.Equal(t, apierror.BadRequest, apierror.KindOf(ValidateMonitorable("mc-demo", "enabled", "collection")))
}
