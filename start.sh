#!/usr/bin/env bash
# RAT — Repo Analysis Tool: one-command startup.
# Installs dependencies (if needed) and starts the API (http://localhost:3001)
# plus the dashboard dev server (http://localhost:5173).
# Requires Node.js 18+ and a git binary on PATH.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "error: Node.js 18+ is required (https://nodejs.org)" >&2
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  echo "error: git is required on PATH" >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "==> Installing dependencies (first run only)…"
  npm install
fi

echo "==> Starting RAT: API on http://localhost:3001, dashboard on http://localhost:5173"
exec npm run dev
