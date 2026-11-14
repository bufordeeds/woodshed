#!/usr/bin/env bash
# Start Woodshed. First run installs everything (a few minutes); later runs start in seconds.
#   ./run.sh                 -> http://127.0.0.1:8000
#   ./run.sh --host 0.0.0.0  -> also reachable from other devices on your network
set -euo pipefail
cd "$(dirname "$0")"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing '$1'. Install it with: $2"; exit 1; }; }
need ffmpeg "brew install ffmpeg"
need node   "brew install node"
need uv     "brew install uv"

# Python side: reinstall only when pyproject.toml changed
if [ ! -x .venv/bin/python ]; then uv venv --python 3.11 .venv; fi
if [ ! -f .venv/.installed ] || [ pyproject.toml -nt .venv/.installed ]; then
  echo "Installing Python packages (first time: several minutes)…"
  extra=()
  # Linux without an NVIDIA card: WOODSHED_TORCH_INDEX=https://download.pytorch.org/whl/cpu avoids the huge CUDA build
  if [ -n "${WOODSHED_TORCH_INDEX:-}" ]; then extra=(--extra-index-url "$WOODSHED_TORCH_INDEX" --index-strategy unsafe-best-match); fi
  uv pip install --python .venv/bin/python "${extra[@]}" -e ".[dev]"
  touch .venv/.installed
fi

# Browser side: rebuild only when the frontend sources changed
if [ ! -f frontend/dist/index.html ] || [ -n "$(find frontend/src frontend/index.html frontend/package.json -newer frontend/dist/index.html -print -quit)" ]; then
  echo "Building the interface…"
  (cd frontend && npm ci --silent && npm run build --silent)
fi

exec .venv/bin/woodshed serve "$@"
