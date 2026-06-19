#!/bin/bash
# Starts the FlowState backend server for local frontend development.
#
# This repo is the standalone Vue frontend; the Go backend lives in a
# separate repository. Point this script at a built binary via one of:
#   - FLOWSTATE_BIN  (absolute path to a `flowstate` executable), or
#   - PATH           (a `flowstate` binary already on your PATH).
# If neither resolves, the script prints a clear error and exits non-zero.

set -euo pipefail

PORT="${PORT:-8080}"

if [ -n "${FLOWSTATE_BIN:-}" ]; then
  BIN="$FLOWSTATE_BIN"
else
  if ! command -v flowstate >/dev/null 2>&1; then
    echo "ERROR: no FlowState backend found." >&2
    echo "Set FLOWSTATE_BIN=/path/to/flowstate or install the binary on PATH." >&2
    exit 1
  fi
  BIN="$(command -v flowstate)"
fi

echo "Starting FlowState backend ($BIN) on localhost:$PORT..."
exec "$BIN" serve --port "$PORT"
