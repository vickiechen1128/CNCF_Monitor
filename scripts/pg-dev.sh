#!/usr/bin/env bash
# Local PostgreSQL helper for MetricCenter v3 testing (Homebrew install, macOS).
#
# Wraps the repetitive start / reset / migrate / test / run steps so switching
# from SQLite to PostgreSQL is a single command. All database access uses the
# local trust-authenticated superuser (`whoami`) on 127.0.0.1:5432.
#
# Usage:
#   ./scripts/pg-dev.sh <command> [db-name]
#
# Commands:
#   start       Start the PostgreSQL service (brew services)
#   stop        Stop the service
#   status      Show service status and configured DSN
#   dsn         Print the connection string (for manual use)
#   reset       Drop and recreate the test database (DESTRUCTIVE)
#   migrate     Apply v3 migrations to the test database
#   mstatus     Show v3 migration status
#   mdown       Roll back one v3 migration (development only)
#   test        Run the PostgreSQL migration integration test
#   run         Boot metric-center in v3-only mode against PostgreSQL
#
# Environment overrides:
#   PG_TEST_DB      test database name (default: metric_center_test)
#   PG_ADMIN_PASSWORD  password passed to run (default: admin123)

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="postgresql@16"
PG_BIN="$(brew --prefix postgresql@16 2>/dev/null)/bin"
DB_NAME="${PG_TEST_DB:-metric_center_test}"
DB_USER="$(whoami)"
DSN="postgres://${DB_USER}@127.0.0.1:5432/${DB_NAME}?sslmode=disable"
GO_BIN="${PROJECT_ROOT}/.tools/go/bin/go"
[[ -x "${GO_BIN}" ]] || GO_BIN="go"

die() { echo "ERROR: $*" >&2; exit 1; }
ensure_service() {
  [[ -x "${PG_BIN}/psql" ]] || die "postgresql@16 not installed (brew install postgresql@16)"
  "${PG_BIN}/pg_isready" -h 127.0.0.1 -p 5432 -q 2>/dev/null || \
    die "PostgreSQL not accepting connections; run '$0 start' first"
}

usage() {
  sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'
}

cmd="${1:-help}"
case "${cmd}" in
  start)
    brew services start "${SERVICE}"
    echo "PostgreSQL started. Test DB DSN: ${DSN}"
    ;;
  stop)
    brew services stop "${SERVICE}"
    ;;
  status)
    brew services list 2>/dev/null | grep -i postgres || true
    echo "Configured test DB : ${DB_NAME}"
    echo "DSN                : ${DSN}"
    ;;
  dsn)
    echo "${DSN}"
    ;;
  reset)
    ensure_service
    if [[ "${2:-}" != "--yes" ]]; then
      echo "About to DESTROY and recreate database '${DB_NAME}'. Pass --yes to confirm."
      exit 1
    fi
    "${PG_BIN}/dropdb" --if-exists "${DB_NAME}"
    "${PG_BIN}/createdb" "${DB_NAME}"
    echo "Database '${DB_NAME}' recreated."
    ;;
  migrate)
    ensure_service
    "${PG_BIN}/psql" -d postgres -tAc \
      "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
      "${PG_BIN}/createdb" "${DB_NAME}"
    cd "${PROJECT_ROOT}"
    METRIC_CENTER_DB_DRIVER=postgres METRIC_CENTER_DB_DSN="${DSN}" "${GO_BIN}" run ./platform/cmd/migrate
    ;;
  mstatus)
    ensure_service
    cd "${PROJECT_ROOT}"
    METRIC_CENTER_DB_DRIVER=postgres METRIC_CENTER_DB_DSN="${DSN}" "${GO_BIN}" run ./platform/cmd/migrate -status
    ;;
  mdown)
    ensure_service
    cd "${PROJECT_ROOT}"
    METRIC_CENTER_DB_DRIVER=postgres METRIC_CENTER_DB_DSN="${DSN}" "${GO_BIN}" run ./platform/cmd/migrate -down
    ;;
  test)
    ensure_service
    # The migration test performs a full Up -> all-Down cycle; some merges
    # (e.g. 0016 config_snapshots) are intentionally irreversible on Down and
    # leave a table behind. Reset first so the cycle always starts clean.
    "${PG_BIN}/dropdb" --if-exists "${DB_NAME}"
    "${PG_BIN}/createdb" "${DB_NAME}"
    cd "${PROJECT_ROOT}"
    set +e
    METRIC_CENTER_TEST_POSTGRES_DSN="${DSN}" "${GO_BIN}" test ./platform/db -run 'TestMigrateV3Postgres|TestConfigSnapshotsMergeBackfillPostgres' -count=1 -v
    test_rc=$?
    set -e
    # The full Up->all-Down cycle leaves irreversible-merge tables behind
    # (e.g. 0016 config_snapshots) with an empty schema_migrations. Reset to a
    # clean empty DB so a following `migrate`/`run` starts from a valid state.
    "${PG_BIN}/dropdb" --if-exists "${DB_NAME}"
    "${PG_BIN}/createdb" "${DB_NAME}"
    exit "${test_rc}"
    ;;
  run)
    ensure_service
    cd "${PROJECT_ROOT}"
    METRIC_CENTER_DB_MODE=v3 \
      METRIC_CENTER_DB_DRIVER=postgres \
      METRIC_CENTER_DB_DSN="${DSN}" \
      METRIC_CENTER_ADMIN_PASSWORD="${PG_ADMIN_PASSWORD:-admin123}" \
      "${GO_BIN}" run ./platform/cmd/metric-center
    ;;
  help|*)
    usage
    ;;
esac
