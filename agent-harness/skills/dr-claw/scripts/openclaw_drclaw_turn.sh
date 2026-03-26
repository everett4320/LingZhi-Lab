#!/bin/sh
set -eu

USER_PY_BIN="$HOME/Library/Python/3.9/bin"
if [ -d "$USER_PY_BIN" ]; then
  PATH="$USER_PY_BIN:$PATH"
fi
export PATH

LOCK_DIR="${HOME}/.openclaw/locks"
DEFAULT_AGENT="${OPENCLAW_DRCLAW_AGENT:-${OPENCLAW_DRCLAW_AGENT_LEGACY:-vibetest2}}"
AGENT="$DEFAULT_AGENT"

if command -v drclaw >/dev/null 2>&1; then
  DRCLAW_BIN_DEFAULT="$(command -v drclaw)"
elif command -v vibelab >/dev/null 2>&1; then
  DRCLAW_BIN_DEFAULT="$(command -v vibelab)"
else
  DRCLAW_BIN_DEFAULT="$USER_PY_BIN/drclaw"
fi

export DRCLAW_BIN="${DRCLAW_BIN:-$DRCLAW_BIN_DEFAULT}"
export DRCLAW_URL="${DRCLAW_URL:-${VIBELAB_URL:-http://localhost:3001}}"

mkdir -p "$LOCK_DIR"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --agent)
      AGENT="$2"
      shift 2
      ;;
    *)
      break
      ;;
  esac
done

LOCK_FILE="$LOCK_DIR/openclaw-local-${AGENT}.lock"
cleanup() {
  rm -f "$LOCK_FILE"
}
trap cleanup EXIT INT TERM HUP

while ! /usr/bin/shlock -p "$$" -f "$LOCK_FILE" >/dev/null 2>&1; do
  sleep 1
done

exec openclaw agent --local --agent "$AGENT" "$@"
