#!/usr/bin/env bash
# Build this fork and overwrite the mise-installed backlog binary (re-run after every mise upgrade).
set -euo pipefail
cd "$(dirname "$0")/.."
bun scripts/build.ts
base="$HOME/AppData/Local/mise/installs/npm-backlog-md"
target=$(ls -d "$base"/[0-9]*.[0-9]*.[0-9]*/node_modules/backlog.md/node_modules/backlog.md-windows-x64 | sort -V | tail -1)/backlog.exe
cp -n "$target" "$target.orig" 2>/dev/null || true
cp dist/backlog.exe "$target" || { echo "Copy failed: close any running backlog (board/browser) first." >&2; exit 1; }
cmp dist/backlog.exe "$target" && echo "Installed to $target"
