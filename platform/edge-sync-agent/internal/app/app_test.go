package app

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

type fakeService struct {
	started  chan struct{}
	stopped  chan struct{}
	runCount *int32
}

func newFakeService(runCount *int32) *fakeService {
	return &fakeService{started: make(chan struct{}), stopped: make(chan struct{}), runCount: runCount}
}

func (f *fakeService) Run(ctx context.Context) {
	atomic.AddInt32(f.runCount, 1)
	close(f.started)
	<-ctx.Done()
	close(f.stopped)
}

type fakeProbe struct{ stopped chan struct{} }

func (f *fakeProbe) StopAll() { close(f.stopped) }

func TestRunnerStartsServicesAndStopsProbe(t *testing.T) {
	var runs int32
	svc := newFakeService(&runs)
	probe := &fakeProbe{stopped: make(chan struct{})}
	stepCalled := make(chan struct{})

	runner := NewRunner(Options{
		StepOnce: func(context.Context) { close(stepCalled) },
		Services: []Service{svc, nil},
		Probe:    probe,
	})

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		runner.Run(ctx)
		close(done)
	}()

	select {
	case <-stepCalled:
	case <-time.After(2 * time.Second):
		t.Fatal("StepOnce was not called")
	}
	select {
	case <-svc.started:
	case <-time.After(2 * time.Second):
		t.Fatal("service did not start")
	}
	if got := atomic.LoadInt32(&runs); got != 1 {
		t.Fatalf("service run count = %d, want 1", got)
	}

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after cancellation")
	}
	select {
	case <-probe.stopped:
	default:
		t.Fatal("probe.StopAll was not called")
	}
	select {
	case <-svc.stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("service did not observe cancellation")
	}
}

func TestRunnerNilProbeAndStepAreSafe(t *testing.T) {
	var runs int32
	svc := newFakeService(&runs)
	runner := NewRunner(Options{Services: []Service{svc}})

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		runner.Run(ctx)
		close(done)
	}()
	<-svc.started
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return")
	}
}
