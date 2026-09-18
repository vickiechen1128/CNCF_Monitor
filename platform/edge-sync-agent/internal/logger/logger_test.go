package logger

import (
	"bytes"
	"strings"
	"testing"
)

func TestLoggerLevelsToWriter(t *testing.T) {
	var buf bytes.Buffer
	lg := New(&buf)
	lg.Infof("hello %s", "world")
	lg.Warnf("warn %d", 1)
	lg.Errorf("error")

	out := buf.String()
	if !strings.Contains(out, "INFO hello world") {
		t.Errorf("missing INFO: %q", out)
	}
	if !strings.Contains(out, "WARN warn 1") {
		t.Errorf("missing WARN: %q", out)
	}
	if !strings.Contains(out, "ERROR error") {
		t.Errorf("missing ERROR: %q", out)
	}
}

func TestSyslogOrStderrNonNil(t *testing.T) {
	if w := SyslogOrStderr(); w == nil {
		t.Fatal("SyslogOrStderr returned nil")
	}
}
