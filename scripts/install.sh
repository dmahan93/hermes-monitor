#!/usr/bin/env bash
# Install hermes-monitor globally so it can be run from any directory.
#
# Usage:
#   ./scripts/install.sh          # install via npm link
#   ./scripts/install.sh --unlink # remove the global link
#
# After running this, `hermes-monitor` will be available as a command.
# From any git repo, just run:
#   hermes-monitor
#
# To uninstall:
#   cd ~/github/hermes-monitor && npm unlink -g

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT"

if [ "${1:-}" = "--unlink" ]; then
  echo "Removing hermes-monitor global link..."
  npm unlink -g hermes-monitor 2>/dev/null || true
  echo "Done. hermes-monitor command removed."
  exit 0
fi

echo "Installing hermes-monitor..."
echo ""

# Install dependencies if needed
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
  echo ""
fi

# Create global symlink
npm link

echo ""
echo "hermes-monitor installed! Run it from any git repo:"
echo ""
echo "  hermes-monitor                          # start in current repo"
echo "  hermes-monitor --repo ~/projects/myapp  # explicit repo path"
echo "  hermes-monitor --port 5000              # custom client port"
echo "  hermes-monitor --build                  # use pre-built client"
echo "  hermes-monitor --help                   # show all options"
echo ""
