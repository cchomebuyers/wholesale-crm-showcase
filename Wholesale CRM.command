#!/bin/bash
# ============================================================================
# Wholesale CRM — macOS launcher (double-clickable)
# ============================================================================
# macOS equivalent of "Wholesale CRM.cmd" / WholesaleCRM.exe. All real logic
# lives in crm-app.mjs (Matrix boot screen, starts CRM + ankhor in watch/HMR
# mode, opens the app window). This wrapper never needs rebuilding — edit the
# .mjs and it hot-reloads.
#
# First run: make it executable so Finder treats it as an app:
#     chmod +x "Wholesale CRM.command"
# then double-click it in Finder (opens in Terminal).
# ============================================================================

# cd into the folder this script lives in (Finder launches from $HOME otherwise)
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR" || { echo "Could not enter CRM folder: $DIR"; exit 1; }

echo "Starting Wholesale CRM live app..."

# Make sure Node is available (Homebrew node lands in /opt/homebrew/bin or /usr/local/bin)
if ! command -v node >/dev/null 2>&1; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
fi
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "[Wholesale CRM] Node.js was not found. Install Node 20+ (https://nodejs.org"
  echo "or 'brew install node') and make sure 'node' is on your PATH, then try again."
  echo
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

if [ ! -f "$DIR/crm-app.mjs" ]; then
  echo "crm-app.mjs was not found next to this launcher:"
  echo "  $DIR/crm-app.mjs"
  echo "Keep 'Wholesale CRM.command' in the CRM root."
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

node "$DIR/crm-app.mjs" "$@"
STATUS=$?

if [ $STATUS -ne 0 ]; then
  echo
  echo "[Wholesale CRM] stopped with an error (exit $STATUS). Review the log above."
  read -n 1 -s -r -p "Press any key to close..."
fi

exit $STATUS
