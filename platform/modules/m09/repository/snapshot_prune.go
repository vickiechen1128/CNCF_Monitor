package repository

import (
	"sort"
	"time"
)

// snapshotPruneCandidate is the subset of a config_snapshots row needed by the
// daily retention planner.
type snapshotPruneCandidate struct {
	ID               int64
	Version          string
	Family           string
	ValidationStatus string
	CreatedAt        time.Time
	IsCurrent        bool
}

// planDailySnapshotPrune implements SRS v1.7 FR-13:
//
//   - failed attempts are not part of snapshot history and are always removed;
//   - successful snapshots keep at most the newest row per natural day;
//   - the current row is never removed;
//   - non-current daily rows older than keepDays are removed.
//
// Family separates scrape config from legacy `am-` alertmanager snapshots that
// share the domain scope, so one family cannot evict the other.
func planDailySnapshotPrune(
	rows []snapshotPruneCandidate,
	keepDays int,
	loc *time.Location,
	now time.Time,
) (removeIDs []int64, removedVersions []string) {
	if keepDays < 1 {
		keepDays = 1
	}
	if loc == nil {
		loc = time.UTC
	}
	dayOf := func(value time.Time) time.Time {
		local := value.In(loc)
		return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	}
	cutoff := dayOf(now).AddDate(0, 0, -(keepDays - 1))

	groups := map[string][]snapshotPruneCandidate{}
	currentDays := map[string]bool{}
	remove := func(row snapshotPruneCandidate) {
		removeIDs = append(removeIDs, row.ID)
		removedVersions = append(removedVersions, row.Version)
	}

	for _, row := range rows {
		key := row.Family + "|" + dayOf(row.CreatedAt).Format("2006-01-02")
		if row.IsCurrent {
			currentDays[key] = true
			continue
		}
		if row.ValidationStatus != "passed" {
			remove(row)
			continue
		}
		groups[key] = append(groups[key], row)
	}

	for key, group := range groups {
		sort.Slice(group, func(i, j int) bool {
			if group[i].CreatedAt.Equal(group[j].CreatedAt) {
				return group[i].ID > group[j].ID
			}
			return group[i].CreatedAt.After(group[j].CreatedAt)
		})
		// The current row is the day's version; same-day earlier attempts are
		// intra-day history and must not appear as separate snapshots.
		if currentDays[key] {
			for _, row := range group {
				remove(row)
			}
			continue
		}
		for i, row := range group {
			if i == 0 {
				if dayOf(row.CreatedAt).Before(cutoff) {
					remove(row)
				}
				continue
			}
			remove(row)
		}
	}
	return removeIDs, removedVersions
}
