#!/usr/bin/env bash
# Local PostgreSQL helper for MetricCenter (Homebrew install, macOS).
#
# Wraps the repetitive start / reset / migrate / test / run steps. PostgreSQL is
# the only supported database; all access uses the local trust-authenticated
# superuser (`whoami`) on 127.0.0.1:5432.
#
# Usage:
#   ./scripts/pg-dev.sh <command>
#
# Commands:
#   start       Start the PostgreSQL service (brew services)
#   stop        Stop the service
#   status      Show service status and configured DSN
#   dsn         Print the connection string (for manual use)
#   ensure-db   Start PG if needed and create the target database (no reset)
#   reset       Drop and recreate the test database (DESTRUCTIVE)
#   migrate     Apply v3 migrations to the test database
#   mstatus     Show v3 migration status
#   mdown       Roll back one v3 migration (development only)
#   test        Run the PostgreSQL migration integration test
#   run         Boot metric-center in v3-only mode against PostgreSQL
#
# Environment overrides:
#   PG_TEST_DB      target database name (default: metric_center_test).
#                   Development DB: PG_TEST_DB=metric_center ./scripts/pg-dev.sh migrate
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
  if "${PG_BIN}/pg_isready" -h 127.0.0.1 -p 5432 -q 2>/dev/null; then
    return 0
  fi
  echo ">>> PostgreSQL not running; starting ${SERVICE}..."
  brew services start "${SERVICE}" >/dev/null 2>&1 || die "failed to start ${SERVICE}"
  for _ in $(seq 1 30); do
    "${PG_BIN}/pg_isready" -h 127.0.0.1 -p 5432 -q 2>/dev/null && return 0
    sleep 1
  done
  die "PostgreSQL did not become ready on 127.0.0.1:5432"
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
  ensure-db)
    ensure_service
    "${PG_BIN}/psql" -d postgres -tAc \
      "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
      "${PG_BIN}/createdb" "${DB_NAME}"
    echo ">>> Database ready: ${DSN}"
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
    # Full backend suite on PostgreSQL. Each test gets its own schema, so no
    # reset is needed between runs; the database only has to exist.
    PG_TEST_DB="${DB_NAME}" "${BASH_SOURCE[0]}" ensure-db
    cd "${PROJECT_ROOT}"
    METRIC_CENTER_TEST_POSTGRES_DSN="${DSN}" "${GO_BIN}" test ./platform/... -count=1
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
