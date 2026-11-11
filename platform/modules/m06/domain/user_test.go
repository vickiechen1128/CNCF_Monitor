package domain

import (
	"regexp"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/foundation/apierror"
)

func TestNewUserID(t *testing.T) {
	pattern := regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	seen := map[string]struct{}{}
	for i := 0; i < 16; i++ {
		id, err := NewUserID()
		require.NoError(t, err)
		assert.Regexp(t, pattern, id)
		_, duplicate := seen[id]
		assert.False(t, duplicate, "generated ids must be unique")
		seen[id] = struct{}{}
	}
}

func TestParseUserStatus(t *testing.T) {
	status, err := ParseUserStatus("")
	require.NoError(t, err)
	assert.Empty(t, status)

	status, err = ParseUserStatus(" active ")
	require.NoError(t, err)
	assert.Equal(t, UserStatusActive, status)

	status, err = ParseUserStatus("disabled")
	require.NoError(t, err)
	assert.Equal(t, UserStatusDisabled, status)

	_, err = ParseUserStatus("locked")
	require.Error(t, err)
	assert.Equal(t, apierror.BadRequest, apierror.KindOf(err))
}

func TestParseUserRole(t *testing.T) {
	role, err := ParseUserRole("")
	require.NoError(t, err)
	assert.Empty(t, role)

	role, err = ParseUserRole("admin")
	require.NoError(t, err)
	assert.Equal(t, UserRoleAdmin, role)

	role, err = ParseUserRole(" user ")
	require.NoError(t, err)
	assert.Equal(t, UserRoleUser, role)

	_, err = ParseUserRole("owner")
	require.Error(t, err)
	assert.Equal(t, apierror.BadRequest, apierror.KindOf(err))
}

func TestUserErrors(t *testing.T) {
	notFound := &UserNotFoundError{UserID: "user-1"}
	assert.Equal(t, apierror.NotFound, apierror.KindOf(notFound))
	assert.Contains(t, notFound.Error(), "user-1")

	taken := &UsernameTakenError{Username: "ops"}
	assert.Equal(t, apierror.Conflict, apierror.KindOf(taken))
	assert.Contains(t, taken.Error(), "ops")

	lastAdmin := &LastAdminError{Operation: "disabling the last active administrator"}
	assert.Equal(t, apierror.Conflict, apierror.KindOf(lastAdmin))
	assert.Contains(t, lastAdmin.Error(), "no active platform administrator")

	invalidRange := &InvalidTimeRangeError{Message: "start_time must not be later than end_time"}
	assert.Equal(t, apierror.BadRequest, apierror.KindOf(invalidRange))
}
