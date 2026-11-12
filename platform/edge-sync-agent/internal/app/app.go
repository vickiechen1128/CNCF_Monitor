// Package app owns the edge-sync-agent runtime loop: one synchronous tick,
// starting the background services, waiting for cancellation and stopping the
// supervised child processes. The CLI (cmd/edge-sync-agent) only assembles
// dependencies and handles signals, which keeps this loop unit-testable with
// injected fakes.
package app

import "context"

// Service is a long-running background loop (supervisor, puller).
type Service interface {
	Run(ctx context.Context)
}

// Probe stops the supervised child processes on shutdown.
type Probe interface {
	StopAll()
}

// Options carries the injected runtime pieces.
type Options struct {
	// StepOnce runs one synchronous step before the background loops start
	// (e.g. an immediate supervisor tick to avoid a startup window).
	StepOnce func(ctx context.Context)
	// Services are started concurrently and stop when ctx is cancelled.
	Services []Service
	// Probe is invoked after cancellation to stop child processes. Nil-safe.
	Probe Probe
}

// Runner drives the runtime loop.
type Runner struct {
	opts Options
}

// NewRunner constructs a Runner.
func NewRunner(opts Options) *Runner {
	return &Runner{opts: opts}
}

// Run executes the synchronous step, starts every service, blocks until ctx is
// cancelled and then stops the child processes. Services are expected to return
// on their own once ctx is cancelled; Run does not wait for them so a stuck
// child cannot block shutdown.
func (r *Runner) Run(ctx context.Context) {
	if r.opts.StepOnce != nil {
		r.opts.StepOnce(ctx)
	}
	for _, service := range r.opts.Services {
		if service == nil {
			continue
		}
		go service.Run(ctx)
	}
	<-ctx.Done()
	if r.opts.Probe != nil {
		r.opts.Probe.StopAll()
	}
}
