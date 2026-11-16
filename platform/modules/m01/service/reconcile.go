package service

import (
	"context"
	"log"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
)

// DefaultReconcileInterval is the D40 pull interval.
const DefaultReconcileInterval = 60 * time.Second

// ReconcileService removes selected instances that no longer exist in M07 (or
// moved to another domain). M07 never calls M01; the pull loop is the only
// cleanup path (D40).
type ReconcileService struct {
	jobs      repository.JobRepository
	resources ResourceReader
	interval  time.Duration
}

// NewReconcileService constructs the service.
func NewReconcileService(jobs repository.JobRepository, resources ResourceReader, interval time.Duration) *ReconcileService {
	if interval <= 0 {
		interval = DefaultReconcileInterval
	}
	return &ReconcileService{jobs: jobs, resources: resources, interval: interval}
}

// Run reconciles immediately and then on every interval until ctx is done.
func (s *ReconcileService) Run(ctx context.Context) {
	s.reconcileAndLog(ctx)
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.reconcileAndLog(ctx)
		}
	}
}

// ReconcileOnce removes stale instance references and returns the changed jobs.
func (s *ReconcileService) ReconcileOnce(ctx context.Context) (int, error) {
	jobs, err := s.jobs.ListAll(ctx)
	if err != nil {
		return 0, err
	}
	ids := make([]string, 0)
	seen := map[string]struct{}{}
	for _, job := range jobs {
		for _, id := range job.SelectedInstanceIDs {
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return 0, nil
	}
	refs, err := s.resources.GetMany(ctx, ids)
	if err != nil {
		return 0, err
	}
	changed := 0
	for _, job := range jobs {
		kept := make([]string, 0, len(job.SelectedInstanceIDs))
		dropped := false
		for _, id := range job.SelectedInstanceIDs {
			ref, ok := refs[id]
			if !ok || ref.NetworkDomainID != job.NetworkDomainID {
				dropped = true
				continue
			}
			kept = append(kept, id)
		}
		if !dropped {
			continue
		}
		job.SelectedInstanceIDs = kept
		if job.DraftStatus == domain.DraftStatusReady && job.Enabled {
			job.Sync = domain.SyncState{Status: domain.SyncPending}
		}
		if err := s.jobs.Update(ctx, job); err != nil {
			return changed, err
		}
		changed++
	}
	return changed, nil
}

func (s *ReconcileService) reconcileAndLog(ctx context.Context) {
	changed, err := s.ReconcileOnce(ctx)
	if err != nil {
		log.Printf("m01 reconcile: %v", err)
		return
	}
	if changed > 0 {
		log.Printf("m01 reconcile: reclaimed instances from %d job(s)", changed)
	}
}
