#!/usr/bin/env bash
# install.sh - one-command setup for the Lingzhi Lab CLI
# Creates a symlink in /usr/local/bin so the CLI is available system-wide.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_NAME="lingzhilab"

echo "==> Installing Python package (editable)..."
pip3 install -e "$SCRIPT_DIR" -q 2>/dev/null || true

# The binary lands in $(python3 -m site --user-base)/bin on macOS user installs
USER_BASE="$(python3 -m site --user-base)"
INSTALLED_BIN="$USER_BASE/bin/$BIN_NAME"

if [ ! -f "$INSTALLED_BIN" ]; then
  echo "ERR Could not find binary at: $INSTALLED_BIN"
  echo "    Try: pip3 install -e $SCRIPT_DIR"
  exit 1
fi

for LINK_NAME in lingzhilab lingzhi-lab vibelab; do
  SYMLINK_TARGET="/usr/local/bin/$LINK_NAME"
  echo "==> Symlinking $LINK_NAME → /usr/local/bin/"
  ln -sf "$INSTALLED_BIN" "$SYMLINK_TARGET" 2>/dev/null \
    || sudo ln -sf "$INSTALLED_BIN" "$SYMLINK_TARGET"
done

echo ""
echo "✓  Installed!  Try:"
echo "   lingzhilab --help"
echo "   lingzhilab server on"
echo "   lingzhilab server status"
echo "   # compatibility aliases still work:"
echo "   lingzhi-lab --help"
echo "   vibelab --help"
