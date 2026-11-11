package apierror

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestKindOf(t *testing.T) {
	assert.Equal(t, Kind(""), KindOf(nil))
	assert.Equal(t, BadRequest, KindOf(New(BadRequest, "bad")))
	assert.Equal(t, Conflict, KindOf(fmt.Errorf("wrap: %w", New(Conflict, "duplicate"))))
	assert.Equal(t, Unavailable, KindOf(context.DeadlineExceeded))
	assert.Equal(t, Internal, KindOf(errors.New("boom")))
}

func TestErrorDefaults(t *testing.T) {
	var nilErr *Error
	assert.Empty(t, nilErr.Error())
	assert.NoError(t, nilErr.Unwrap())
	assert.Equal(t, Internal, nilErr.ErrorKind())

	err := Wrap(NotFound, "resource missing", errors.New("db"))
	assert.Equal(t, "resource missing", err.Error())
	assert.Equal(t, NotFound, err.ErrorKind())
	assert.EqualError(t, err.Unwrap(), "db")

	assert.Equal(t, "bad_request", New(BadRequest, "").Error())
}

func TestStatusCode(t *testing.T) {
	cases := map[Kind]int{
		BadRequest: 400, Unauthorized: 401, Forbidden: 403,
		NotFound: 404, Conflict: 409, Unavailable: 503, Internal: 500,
		Kind("unknown"): 500,
	}
	for kind, want := range cases {
		assert.Equal(t, want, StatusCode(kind), kind)
	}
}

type legacyCoded struct{}

func (legacyCoded) Error() string   { return "legacy" }
func (legacyCoded) ErrorKind() Kind { return Forbidden }

func TestKindOfInterface(t *testing.T) {
	assert.Equal(t, Forbidden, KindOf(legacyCoded{}))
}
