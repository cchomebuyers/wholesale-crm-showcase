#!/bin/bash
# Focus Terminal — double-click launcher (macOS). Mirrors "Wholesale CRM.command".
DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Install it from https://nodejs.org (Node 22+)."
  read -r -p "Press enter to close..."
  exit 1
fi

cd "$DIR"
exec node "$DIR/focus/focus-terminal.mjs" "$@"
