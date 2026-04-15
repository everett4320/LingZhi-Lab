#!/bin/sh
set -eu

PROJECT=""
SESSION_ID=""
TIMEOUT=180
INTERVAL=5
LINGZHILAB_BIN="${LINGZHILAB_BIN:-lingzhilab}"

if ! command -v "$LINGZHILAB_BIN" >/dev/null 2>&1; then
  LINGZHILAB_BIN="lingzhi-lab"
fi

if ! command -v "$LINGZHILAB_BIN" >/dev/null 2>&1; then
  LINGZHILAB_BIN="vibelab"
fi

json_string() {
  printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --project)
      PROJECT="$2"
      shift 2
      ;;
    --session)
      SESSION_ID="$2"
      shift 2
      ;;
    --timeout)
      TIMEOUT="$2"
      shift 2
      ;;
    --interval)
      INTERVAL="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

[ -n "$PROJECT" ] || { echo "missing --project" >&2; exit 2; }
[ -n "$SESSION_ID" ] || { echo "missing --session" >&2; exit 2; }

START_TS=$(date +%s)
POLLS=0
LAST_WAITING='[]'

while :; do
  LAST_WAITING=$($LINGZHILAB_BIN chat waiting --project "$PROJECT" --json 2>/dev/null || printf '[]')
  POLLS=$((POLLS + 1))
  ELAPSED=$(( $(date +%s) - START_TS ))

  case "$LAST_WAITING" in
    *"$SESSION_ID"*) FOUND=1 ;;
    *) FOUND=0 ;;
  esac

  if [ "$FOUND" -eq 0 ]; then
    printf '{"project":%s,"session_id":%s,"done":true,"timed_out":false,"elapsed_seconds":%s,"polls":%s,"last_waiting":%s}\n' \
      "$(json_string "$PROJECT")" \
      "$(json_string "$SESSION_ID")" \
      "$ELAPSED" \
      "$POLLS" \
      "$LAST_WAITING"
    exit 0
  fi

  if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    printf '{"project":%s,"session_id":%s,"done":false,"timed_out":true,"elapsed_seconds":%s,"polls":%s,"last_waiting":%s}\n' \
      "$(json_string "$PROJECT")" \
      "$(json_string "$SESSION_ID")" \
      "$ELAPSED" \
      "$POLLS" \
      "$LAST_WAITING"
    exit 1
  fi

  sleep "$INTERVAL"
done
