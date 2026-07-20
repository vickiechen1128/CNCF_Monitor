#!/bin/bash
# run_cmd.sh - CNCF_Monitor devtools plugin helper

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$PROJECT_ROOT"

COMMAND="$1"
shift || true

case "$COMMAND" in
  test)
    PACKAGE="${1:-./platform/...}"
    echo ">>> Running go test $PACKAGE"
    go test "$PACKAGE"
    ;;
  vet)
    echo ">>> Running go vet ./platform/..."
    go vet ./platform/...
    ;;
  build)
    echo ">>> Building metric-center"
    make build-prometheus
    ;;
  lint)
    echo ">>> Running frontend lint"
    cd ui-custom/web
    pnpm lint
    ;;
  frontend-test)
    echo ">>> Running frontend tests"
    cd ui-custom/web
    pnpm test
    ;;
  apply-patches)
    echo ">>> Applying patches"
    make apply-patches
    ;;
  *)
    echo "Unknown command: $COMMAND"
    echo "Usage: $0 {test|vet|build|lint|frontend-test|apply-patches}"
    exit 1
    ;;
esac
