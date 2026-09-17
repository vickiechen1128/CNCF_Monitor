package auth

import (
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestLoginRateLimiter_ThresholdLocksAndExpires 覆盖 M-1 限流记账器的核心语义：
// 同窗口内连续失败达阈值触发锁定、锁定期内拒绝、锁定过期后可重试。
func TestLoginRateLimiter_ThresholdLocksAndExpires(t *testing.T) {
	l := newLoginRateLimiter()
	start := time.Date(2026, 8, 28, 10, 0, 0, 0, time.UTC)

	// 窗口内 5 次连续失败（每次间隔 1 分钟，仍在 15 分钟窗口内）→ 第 5 次触发锁定。
	var locked bool
	for i := 0; i < loginFailThreshold; i++ {
		now := start.Add(time.Duration(i) * time.Minute)
		locked = l.recordFailure("alice", now)
	}
	assert.True(t, locked, "第 5 次连续失败应触发锁定")

	// 锁定期内拒绝。
	assert.True(t, l.checkLocked("alice", start.Add(5*time.Minute)), "锁定期间应拒绝登录")
	assert.True(t, l.checkLocked("alice", start.Add(5*time.Minute+time.Second)), "锁定期间应拒绝登录")

	// 锁定过期（超过 loginLockDuration=15min）后自动解除，可重试。
	assert.False(t, l.checkLocked("alice", start.Add(5*time.Minute+loginLockDuration+time.Second)),
		"锁定过期后应解除并可重试")
}

// TestLoginRateLimiter_WindowSlidingReset 覆盖滑动窗口语义：超过 loginFailWindow
// 后失败计数归零，重新累积，不会因跨窗口累计而误锁。
func TestLoginRateLimiter_WindowSlidingReset(t *testing.T) {
	l := newLoginRateLimiter()
	start := time.Date(2026, 8, 28, 10, 0, 0, 0, time.UTC)

	// 4 次失败（未达阈值）。
	for i := 0; i < loginFailThreshold-1; i++ {
		l.recordFailure("bob", start.Add(time.Duration(i)*time.Minute))
	}
	assert.False(t, l.checkLocked("bob", start.Add(4*time.Minute)), "未达阈值不得锁定")

	// 窗口过期（>15min）后再失败，计数重置为 1，仍不锁定。
	assert.False(t, l.recordFailure("bob", start.Add(16*time.Minute)), "窗口过期后计数应重置")
	assert.False(t, l.recordFailure("bob", start.Add(17*time.Minute)), "重置后需重新累积 5 次才锁定")
}

// TestLoginRateLimiter_ResetClears 覆盖 reset：成功登录后清除失败记账，避免旧失败
// 计数继续累积导致误锁。
func TestLoginRateLimiter_ResetClears(t *testing.T) {
	l := newLoginRateLimiter()
	start := time.Date(2026, 8, 28, 10, 0, 0, 0, time.UTC)

	for i := 0; i < loginFailThreshold-1; i++ {
		l.recordFailure("carol", start.Add(time.Duration(i)*time.Minute))
	}
	l.reset("carol")
	// 重置后仍未超过阈值，不锁定。
	assert.False(t, l.recordFailure("carol", start.Add(10*time.Minute)))
	assert.False(t, l.checkLocked("carol", start.Add(10*time.Minute)))
}

// TestLogin_RateLimitLocksAfterThreshold 端到端（经 HTTP）：同一用户名连续失败达
// 阈值后续登录被拒并返回 429 too_many_requests。
func TestLogin_RateLimitLocksAfterThreshold(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	// 独立用户名，避免与既有登录测试（admin/ghost）的失败计数互相污染。
	seedUser(t, db, "u-lock", "lockvictim", "受害者", "correct-pass1")

	// 第 1~5 次错误密码：401 unauthorized，第 5 次触发锁定。
	for i := 0; i < loginFailThreshold; i++ {
		w := perform(t, r, http.MethodPost, "/api/v2/platform/auth/login",
			`{"username":"lockvictim","password":"wrong-pass"}`, "")
		require.Equal(t, http.StatusUnauthorized, w.Code, "第 %d 次连续失败应 401", i+1)
		assert.Equal(t, "unauthorized", decodeEnvelope(t, w).ErrorType)
	}

	// 第 6 次（锁定期内）：拒绝为 429 too_many_requests。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/auth/login",
		`{"username":"lockvictim","password":"wrong-pass"}`, "")
	require.Equal(t, http.StatusTooManyRequests, w.Code, "锁定后应返回 429")
	env := decodeEnvelope(t, w)
	assert.Equal(t, "too_many_requests", env.ErrorType)
	assert.Equal(t, "尝试次数过多，请稍后再试", env.Error)
}

// TestLogin_RateLimitResetAfterSuccess 覆盖成功登录解除锁定：达阈值前成功登录会
// 清除失败记账，之后不再因旧计数而误拒。
func TestLogin_RateLimitResetAfterSuccess(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	svc := NewService(NewRepository(db))
	seedUser(t, db, "u-rl", "rlvictim", "运维", "correct-pass1")

	// 3 次失败（未达阈值）。
	for i := 0; i < 3; i++ {
		_, err := svc.Login("rlvictim", "wrong-pass", "127.0.0.1")
		assert.ErrorIs(t, err, ErrInvalidCredentials)
	}

	// 成功登录：解除失败记账。
	_, err := svc.Login("rlvictim", "correct-pass1", "127.0.0.1")
	require.NoError(t, err)

	// 再失败 4 次（计数从 0 重新累计，未达 5）→ 仍 401，不误锁。
	for i := 0; i < loginFailThreshold-1; i++ {
		_, err := svc.Login("rlvictim", "wrong-pass", "127.0.0.1")
		assert.ErrorIs(t, err, ErrInvalidCredentials, "成功登录后失败计数应被重置")
	}
	w := perform(t, r, http.MethodPost, "/api/v2/platform/auth/login",
		`{"username":"rlvictim","password":"correct-pass1"}`, "")
	require.Equal(t, http.StatusOK, w.Code, "重置后不得误锁，正确密码应可登录")
}