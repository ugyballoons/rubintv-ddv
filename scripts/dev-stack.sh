#!/usr/bin/env bash
# Start the synthetic backend the end-to-end tests use: the analysis service's
# mock broker and this repo's sqlite dev worker, on a port that does not collide
# with a developer's own broker. Requires the analysis service checkout beside
# this repo and its conda environment active.
#
#   scripts/dev-stack.sh          # broker + worker on port 9927, foreground, Ctrl-C stops both
#   E2E_WS_PORT=9930 scripts/dev-stack.sh
set -euo pipefail
PORT="${E2E_WS_PORT:-9927}"
ROWS="${E2E_ROWS:-100000}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE="${DDV_SERVICE:-$HERE/../rubintv_analysis_service}"

python "$SERVICE/scripts/mock_server.py" -p "$PORT" -a localhost &
BROKER=$!
trap 'kill $BROKER 2>/dev/null || true' EXIT
until nc -z localhost "$PORT"; do sleep 0.3; done
python "$HERE/scripts/dev_worker.py" -p "$PORT" --rows "$ROWS" --service "$SERVICE"
