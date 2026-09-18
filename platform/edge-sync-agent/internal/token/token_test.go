package token

import (
	"testing"
	"time"
)

func TestThrottleBackoffSequence(t *testing.T) {
	now := time.Unix(1700000000, 0)
	tm := &now
	clock := func() time.Time { return *tm }

	th := NewThrottle(5*time.Second, 60*time.Second, 10*time.Minute, 5*time.Minute, clock)
	want := []time.Duration{5, 10, 20, 40, 60, 60}
	for i, w := range want {
		got, downgraded := th.Next()
		if got != w*time.Second {
			t.Errorf("step %d: got %s want %s", i, got, w*time.Second)
		}
		if downgraded {
			t.Errorf("step %d: unexpected downgrade", i)
		}
	}
	if th.Consecutive() != 6 {
		t.Errorf("consecutive = %d", th.Consecutive())
	}
}

func TestThrottleDowngradeAfterDuration(t *testing.T) {
	start := time.Unix(1700000000, 0)
	tm := &start
	clock := func() time.Time { return *tm }

	th := NewThrottle(5*time.Second, 60*time.Second, 10*time.Minute, 5*time.Minute, clock)
	// 模拟前 5 次 401。
	for i := 0; i < 5; i++ {
		*tm = tm.Add(2 * time.Second) // 累计 10s，未到 10min
		_, downgraded := th.Next()
		if downgraded {
			t.Fatal("should not downgrade yet")
		}
	}
	// 累计超过 10min 后应降频为 5min。
	*tm = start.Add(11 * time.Minute)
	interval, downgraded := th.Next()
	if !downgraded {
		t.Fatal("expected downgrade after >10min")
	}
	if interval != 5*time.Minute {
		t.Errorf("downgrade interval = %s want 5min", interval)
	}
}

func TestThrottleReset(t *testing.T) {
	now := time.Now()
	th := NewThrottle(5*time.Second, 60*time.Second, 10*time.Minute, 5*time.Minute, func() time.Time { return now })
	th.Next()
	th.Next()
	th.Reset()
	if th.Consecutive() != 0 {
		t.Fatalf("after reset consecutive = %d", th.Consecutive())
	}
	got, _ := th.Next()
	if got != 5*time.Second {
		t.Errorf("after reset first backoff = %s want 5s", got)
	}
}

func TestTokenStore(t *testing.T) {
	s := NewStore("old")
	if s.Get() != "old" {
		t.Fatal("initial token mismatch")
	}
	s.Refresh("new")
	if s.Get() != "new" {
		t.Fatal("refresh failed")
	}
}
