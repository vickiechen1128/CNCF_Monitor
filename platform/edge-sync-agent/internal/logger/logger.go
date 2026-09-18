// Package logger 提供 Edge Sync Agent 的统一日志出口。
//
// 默认尝试写入本地 syslog（满足 PRD §6.2「写本地 syslog」）；当平台不支持 syslog
// （如 macOS / 容器 / Windows）时自动回落至 stderr。单测可注入 io.Writer 验证输出。
package logger

import (
	"fmt"
	"io"
	"log"
	"os"
)

// Logger 是日志门面，包含 Info / Warn / Error 三个级别。
type Logger struct {
	l *log.Logger
}

// New 以指定 writer 构造 Logger。writer 为 nil 时回落 stderr。
func New(w io.Writer) *Logger {
	if w == nil {
		w = os.Stderr
	}
	return &Logger{l: log.New(w, "", log.LstdFlags)}
}

// SyslogOrStderr 返回一个适合平台的日志 writer：Linux 下优先 syslog，
// 失败或非 Linux 平台回落 stderr。
func SyslogOrStderr() io.Writer {
	if w, ok := syslogWriter(); ok {
		return w
	}
	return os.Stderr
}

// Infof 输出 INFO 日志。
func (lg *Logger) Infof(format string, a ...any) { lg.l.Printf("INFO "+format, a...) }

// Warnf 输出 WARN 日志。
func (lg *Logger) Warnf(format string, a ...any) { lg.l.Printf("WARN "+format, a...) }

// Errorf 输出 ERROR 日志。
func (lg *Logger) Errorf(format string, a ...any) { lg.l.Printf("ERROR "+format, a...) }

// Close 释放底层 syslog 连接（非 syslog 时无操作）。
func (lg *Logger) Close() {
	if c, ok := lg.l.Writer().(io.Closer); ok {
		_ = c.Close()
	}
}

// 便于调试的格式化占位保护。
var _ = fmt.Sprintf
