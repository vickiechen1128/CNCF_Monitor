// Command migrate applies the MetricCenter v3 database migrations.
//
// Usage:
//
//	go run ./platform/cmd/migrate            # apply all pending v3 migrations
//	go run ./platform/cmd/migrate -status    # show current status
//	go run ./platform/cmd/migrate -down      # roll back one migration (dev only)
//
// PostgreSQL is the only supported database. The driver defaults to
// METRIC_CENTER_DB_DRIVER, then to postgres. The DSN defaults to
// METRIC_CENTER_DB_DSN, then to the local PostgreSQL DSN defined by platform/db.
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
		driver = flag.String("driver", "", "database driver (only postgres is supported; default: METRIC_CENTER_DB_DRIVER or postgres)")
		dsn    = flag.String("dsn", "", "database DSN (default: METRIC_CENTER_DB_DSN or local PostgreSQL DSN)")
	)
	flag.Parse()

	if *driver == "" {
		*driver = db.DBDriver()
	}
	if *dsn == "" {
		*dsn = db.DSN()
	}

	var err error
	switch {
	case *status:
		err = db.MigrateV3Status(*driver, *dsn)
	case *down:
		err = db.MigrateV3Down(*driver, *dsn)
	default:
		err = db.MigrateV3(*driver, *dsn)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "migrate: %v\n", err)
		os.Exit(1)
	}
}
