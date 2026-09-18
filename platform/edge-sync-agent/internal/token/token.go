// Package token 提供 Token 缓存与 401 鉴权失败退避状态机（PRD §6.2 / §9.2）。
//
// 语义：
//   - Store：缓存当前有效 Token（供 Bearer 头），reset-token 后可刷新；
//   - Throttle：连续 401 时指数退避（min→max，如 5s→60s），持续 401 超过
//     降频阈值（默认 10min）后无条件降为低频探测间隔（默认 5min 一次）。
//     时间可注入（clock func），便于单测验证退避序列与降频。
package token

import "time"

// Store 缓存当前有效的网域 Token。
type Store struct {
	token string
}

// NewStore 以初始 token 构造缓存。
func NewStore(token string) *Store { return &Store{token: token} }

// Get 返回当前 Token。
func (s *Store) Get() string { return s.token }

// Refresh 刷新 Token（reset-token 后调用）。
func (s *Store) Refresh(t string) { s.token = t }

// Throttle 是 401 退避 / 降频状态机。
type Throttle struct {
	consecutive        int
	failStart          time.Time
	clock              func() time.Time
	min                time.Duration
	max                time.Duration
	downgradeAfter     time.Duration
	downgradeInterval  time.Duration
}

// NewThrottle 构造状态机。min/max 为指数退避区间；downgradeAfter 为持续 401 触发降频
// 的累积时长；downgradeInterval 为降频后的探测间隔。clock 可为 nil（回退 time.Now）。
func NewThrottle(min, max, downgradeAfter, downgradeInterval time.Duration, clock func() time.Time) *Throttle {
	if clock == nil {
		clock = time.Now
	}
	return &Throttle{
		clock:              clock,
		min:                min,
		max:                max,
		downgradeAfter:     downgradeAfter,
		downgradeInterval:  downgradeInterval,
	}
}

// Reset 清空连续失败计数（成功心跳 / 非 401 错误后调用）。
func (t *Throttle) Reset() {
	t.consecutive = 0
	t.failStart = time.Time{}
}

// Next 在一次 401 后调用，返回应等待的下次探测间隔与是否已降频。
//
// 退避序列：min×2^(n-1)（5→10→20→40→60s，到达 max 即封顶）；
// 自首次 401 起的持续时间 ≥ downgradeAfter（默认 10min）后返回降频间隔（默认 5min）并标记降频。
func (t *Throttle) Next() (interval time.Duration, downgraded bool) {
	now := t.clock()
	if t.consecutive == 0 {
		t.failStart = now
	}
	t.consecutive++

	interval = t.min
	if t.consecutive > 1 {
		shift := t.consecutive - 1
		var mult time.Duration = 1
		// 防溢出：指数到达合理上界后直接封顶。
		for i := 0; i < shift && mult <= hour; i++ {
			mult *= 2
		}
		interval = t.min * mult
	}
	if interval > t.max || interval <= 0 {
		interval = t.max
	}

	if !t.failStart.IsZero() && now.Sub(t.failStart) >= t.downgradeAfter {
		return t.downgradeInterval, true
	}
	return interval, false
}

// Consecutive 返回当前连续 401 次数（观测/测试用）。
func (t *Throttle) Consecutive() int { return t.consecutive }

const hour = time.Hour
