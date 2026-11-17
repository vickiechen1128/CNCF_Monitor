package service

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
)

func TestAmtoolCheckerMissingToolIsRetryable(t *testing.T) {
	checker := NewAmtoolCheckerWith(func(string) (string, error) {
		return "", errors.New("exec: amtool: not found")
	}, nil)
	err := checker.Check(context.Background(), "route: {}\n")
	var unavailable *domain.UnavailableError
	assert.ErrorAs(t, err, &unavailable)
}

func TestAmtoolCheckerSuccess(t *testing.T) {
	checker := NewAmtoolCheckerWith(
		func(string) (string, error) { return "/usr/local/bin/amtool", nil },
		func(_ context.Context, _ string, _ string) (string, error) {
			return "Checking 'alertmanager.yml'  SUCCESS", nil
		},
	)
	require.NoError(t, checker.Check(context.Background(), "route: {}\n"))
}

func TestAmtoolCheckerParsesLineIssues(t *testing.T) {
	checker := NewAmtoolCheckerWith(
		func(string) (string, error) { return "/usr/local/bin/amtool", nil },
		func(_ context.Context, _ string, _ string) (string, error) {
			return "Checking 'alertmanager.yml'  FAILED: alertmanager.yml:12:5: receiver not found", errors.New("exit 1")
		},
	)
	err := checker.Check(context.Background(), "route: {}\n")
	var validation *domain.ConfigValidationError
	require.ErrorAs(t, err, &validation)
	assert.Equal(t, domain.ValidationCauseUserConfig, validation.Cause)
	require.NotEmpty(t, validation.Items)
	assert.Equal(t, 12, validation.Items[0].Line)
}

func TestAmtoolCheckerCrashIsPlatformFault(t *testing.T) {
	checker := NewAmtoolCheckerWith(
		func(string) (string, error) { return "/usr/local/bin/amtool", nil },
		func(_ context.Context, _ string, _ string) (string, error) {
			return "panic: runtime error", errors.New("signal: killed")
		},
	)
	err := checker.Check(context.Background(), "route: {}\n")
	var unavailable *domain.UnavailableError
	assert.ErrorAs(t, err, &unavailable)
}
