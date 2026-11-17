// Package apply is the M08 internal reload submodule (FR-07): it writes the
// generated alertmanager.yml atomically, triggers a reload, verifies the
// result, rolls back on failure and records every attempt.
//
// Success criterion (D46): the reload endpoint returns 2xx AND the subsequent
// health check passes. A missing reload target is a retryable 503; an
// unreachable Alertmanager is a 502.
package apply

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m08/repository"
)

// Reloader triggers and verifies an Alertmanager reload.
type Reloader interface {
	Reload(ctx context.Context) error
	Verify(ctx context.Context) error
}

// Request describes one apply attempt.
type Request struct {
	SnapshotID    *int64
	ConfigVersion string
	Checksum      string
	Content       string
	Operator      string
	Trigger       domain.ReloadTrigger
	// PreviousContent is restored when the reload fails; empty skips rollback.
	PreviousContent string
	// Force reloads even when the on-disk content is unchanged (manual replay).
	Force bool
}

// Result reports the outcome of an apply attempt.
type Result struct {
	Status     domain.ReloadStatus
	DurationMS int64
	At         time.Time
	Error      string
	Written    bool
}

// Applier applies generated configuration to the local Alertmanager.
type Applier struct {
	dir      string
	reloader Reloader
	logs     repository.ReloadLogRepository
	now      func() time.Time
}

// New constructs an applier. dir is the Alertmanager config directory; an empty
// dir or nil reloader makes Apply return a retryable 503 (D46).
func New(dir string, reloader Reloader, logs repository.ReloadLogRepository) *Applier {
	return &Applier{dir: dir, reloader: reloader, logs: logs, now: func() time.Time { return time.Now().UTC() }}
}

// SetClock overrides the clock (tests).
func (a *Applier) SetClock(now func() time.Time) { a.now = now }

// Apply writes, reloads, verifies, optionally rolls back, and always records
// the attempt. A returned error is the operator-facing failure; Result carries
// the persisted status either way.
func (a *Applier) Apply(ctx context.Context, req Request) (Result, error) {
	started := a.now()
	if a.dir == "" || a.reloader == nil {
		result := Result{Status: domain.ReloadStatusFailed, At: started, Error: "reload target not configured"}
		a.record(ctx, req, result, started)
		return result, &domain.UnavailableError{
			Message: "Alertmanager reload 目标未配置，配置未下发；请配置 --alertmanager.config-dir 与 --alertmanager.url（D46）",
		}
	}

	path := filepath.Join(a.dir, "alertmanager.yml")
	written := false
	if req.Force || !sameContent(path, req.Content) {
		if err := writeAtomic(path, req.Content); err != nil {
			result := Result{Status: domain.ReloadStatusFailed, At: started, Error: err.Error()}
			a.record(ctx, req, result, started)
			return result, fmt.Errorf("write alertmanager.yml: %w", err)
		}
		written = true
	}

	reloadErr := a.reloader.Reload(ctx)
	if reloadErr == nil {
		reloadErr = a.reloader.Verify(ctx)
	}
	if reloadErr == nil {
		result := Result{
			Status:     domain.ReloadStatusSucceeded,
			DurationMS: a.now().Sub(started).Milliseconds(),
			At:         a.now(), Written: written,
		}
		a.record(ctx, req, result, started)
		return result, nil
	}

	// Failure: restore the previous effective content and reload again.
	failure := reloadErr.Error()
	status := domain.ReloadStatusFailed
	if req.PreviousContent != "" {
		if err := writeAtomic(path, req.PreviousContent); err != nil {
			failure = fmt.Sprintf("%s; rollback write failed: %v", failure, err)
		} else if err := a.reloader.Reload(ctx); err != nil {
			failure = fmt.Sprintf("%s; rollback reload failed: %v", failure, err)
		} else {
			status = domain.ReloadStatusRolledBack
		}
	}
	result := Result{
		Status:     status,
		DurationMS: a.now().Sub(started).Milliseconds(),
		At:         a.now(),
		Error:      failure,
		Written:    written,
	}
	a.record(ctx, req, result, started)
	return result, &domain.UpstreamError{Message: "Alertmanager reload 失败，已尝试回退上一生效配置", Err: reloadErr}
}

func (a *Applier) record(ctx context.Context, req Request, result Result, started time.Time) {
	if a.logs == nil {
		return
	}
	finished := result.At
	entry := &domain.ReloadLog{
		SnapshotID: req.SnapshotID, ConfigVersion: req.ConfigVersion, Checksum: req.Checksum,
		Trigger: req.Trigger, Status: result.Status, Operator: req.Operator,
		Error: result.Error, DurationMS: result.DurationMS, StartedAt: started,
		FinishedAt: &finished,
	}
	// A logging failure must not mask the apply outcome; the caller still gets
	// the reload result.
	_ = a.logs.Insert(ctx, entry)
}

func sameContent(path, content string) bool {
	current, err := os.ReadFile(path)
	return err == nil && string(current) == content
}

func writeAtomic(path, content string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".alertmanager-*.yml")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err := tmp.WriteString(content); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}
