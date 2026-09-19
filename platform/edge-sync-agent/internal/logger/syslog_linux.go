//go:build linux

package logger

import (
	"io"
	"log/syslog"
)

// syslogWriter 尝试打开本地 syslog（local0 设施），失败返回 ok=false。
func syslogWriter() (io.Writer, bool) {
	w, err := syslog.New(syslog.LOG_INFO|syslog.LOG_LOCAL0, "edge-sync-agent")
	if err != nil {
		return nil, false
	}
	return w, true
}
