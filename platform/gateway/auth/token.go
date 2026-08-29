package auth

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
)

// 本文件承载轻量认证（Module_03 §4.0）的不透明 Token 生成与会话生命周期语义：
//
//   - Token 为 32 字节高强度随机串（crypto/rand），hex 编码为 64 字符，不可预测、
//     可跨字节安全传输；任何接口/日志只携带 Token，绝不携带明文密码或其哈希。
//   - 会话有效期由 models.Session.ExpiresAt 决定（签发时 +SessionTTL），并遵从
//     契约的失效语义：过期 / 登出 / 改密 / 用户被禁用即失效——均由 service 层在
//     repository 的 sessions 行操作（删除行 / 校验 ExpiresAt）之上实现。

// generateToken 生成一个不透明随机会话令牌（32 字节随机 = 64 位 hex）。
// 高强度熵确保 token 不可被预测或枚举；调用方应将其存入服务端 sessions 表，
// 不透明托管，绝不落明文密码或哈希到该令牌的任何派生载体。
func generateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate session token: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// newID 生成 uuid v4 字符串（crypto/rand，无外部依赖；与
// platform/admin/user/service.go 的 newUserID 同风格）。
func newID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate id: %w", err)
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%s-%s-%s-%s-%s",
		hex.EncodeToString(b[0:4]),
		hex.EncodeToString(b[4:6]),
		hex.EncodeToString(b[6:8]),
		hex.EncodeToString(b[8:10]),
		hex.EncodeToString(b[10:16]),
	), nil
}