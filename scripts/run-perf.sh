#!/usr/bin/env bash
# Start the API from a given folder, seed it, run the k6 CI test, stop the API.
#
# Usage: scripts/run-perf.sh <app-dir> <summary-json> [k6-script]
#   app-dir       folder that contains app/ (the PR checkout, or the main checkout)
#   summary-json  where k6 writes its end-of-test summary
#   k6-script     defaults to k6/ci-perf.js from THIS repo checkout, so both runs use the same test
#
# Exits with k6's own exit code (0 = all thresholds passed, 99 = a threshold failed).
set -euo pipefail   # pipefail: without it, `k6 run ... | tee` would hide k6's exit code

APP_DIR="$(cd "$1" && pwd)"
mkdir -p "$(dirname "$2")"
SUMMARY="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
SCRIPT="$(cd "$(dirname "${3:-k6/ci-perf.js}")" && pwd)/$(basename "${3:-k6/ci-perf.js}")"
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"   # seed.py comes from this checkout too
PORT="${PORT:-8000}"
SEED_USERS="${SEED_USERS:-1000}"
SEED_ITEMS="${SEED_ITEMS:-50}"

cd "$APP_DIR"
rm -f app.db app.db-shm app.db-wal          # same starting point every run

python "$SCRIPTS_DIR/seed.py" --users "$SEED_USERS" --items "$SEED_ITEMS"

fastapi run app/main.py --port "$PORT" > "$SUMMARY.server.log" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

# Wait up to 30s for /health
for _ in $(seq 1 30); do
  curl -sf "http://localhost:$PORT/health" > /dev/null && break
  sleep 1
done
curl -sf "http://localhost:$PORT/health" > /dev/null || { echo "API did not start"; cat "$SUMMARY.server.log"; exit 1; }

set +e
k6 run --quiet -e BASE_URL="http://localhost:$PORT" --summary-export "$SUMMARY" "$SCRIPT"
K6_EXIT=$?
set -e

echo "k6 exit code: $K6_EXIT"
exit $K6_EXIT
