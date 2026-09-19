//go:build !linux

package logger

import "io"

// syslogWriter 在非 Linux 平台不提供 syslog，回落 stderr。
func syslogWriter() (io.Writer, bool) { return nil, false }
