// Command migrate applies the MetricCenter v3 database migrations.
//
// Usage:
//
//	go run ./platform/cmd/migrate            # apply all pending v3 migrations
//	go run ./platform/cmd/migrate -status    # show current status
//	go run ./platform/cmd/migrate -down      # roll back one migration (dev only)
//
// The DSN defaults to METRIC_CENTER_DB_DSN, then to metric_center.db, matching
// the control-plane binary.
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/metriccenter/metriccenter/platform/db"
)

func main() {
	var (
		status = flag.Bool("status", false, "show migration status")
		down   = flag.Bool("down", false, "roll back one migration (development only)")
		dsn    = flag.String("dsn", "", "SQLite DSN (default: METRIC_CENTER_DB_DSN or metric_center.db)")
	)
	flag.Parse()

	if *dsn == "" {
		*dsn = os.Getenv("METRIC_CENTER_DB_DSN")
	}
	if *dsn == "" {
		*dsn = "metric_center.db"
	}

	var err error
	switch {
	case *status:
		err = db.MigrateV3Status(*dsn)
	case *down:
		err = db.MigrateV3Down(*dsn)
	default:
		err = db.MigrateV3(*dsn)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "migrate: %v\n", err)
		os.Exit(1)
	}
}
