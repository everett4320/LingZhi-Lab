# Codex Execution Kernel Migration Runbook

## Scope
- Worktree: `lingzhi-lab-custom-bridge`
- Provider: `codex` only
- Runtime architecture: Node bridge shell + Rust `app-server v2` execution kernel

## Runtime Modes
- `legacy`: serves through `openai-codex.js`.
- `shadow`: serves user traffic through legacy while running bridge path in parallel for parity capture.
- `bridge`: serves user traffic through bridge runtime only.

Set mode with environment variable:

```bash
CODEX_RUNTIME_MODE=legacy|shadow|bridge
```

## CODEX_HOME Resolution
- Desktop bridge runtime defaults `CODEX_HOME` to `~/.codex` (same auth/config home as Codex CLI).
- Override priority (highest to lowest):
  1. `LINGZHI_CODEX_HOME`
  2. default `~/.codex`
- `~/.codex/auth.json` and `~/.codex/config.toml` are the authoritative auth/provider config unless explicitly overridden.

## Unified Protocol Contract
- Frontend inbound events (authoritative):
  - `chat-session-created`
  - `chat-session-upsert`
  - `chat-turn-accepted`
  - `chat-turn-delta`
  - `chat-turn-item`
  - `chat-turn-complete`
  - `chat-turn-error`
  - `chat-turn-aborted`
  - `session-status`
  - `session-state-changed`
- Frontend outbound commands (migration window):
  - `codex-command`
  - `abort-session`
  - `check-session-status`

## Shadow Parity Observability
- Read parity snapshot:
  - `GET /api/codex/parity`
- Reset parity snapshot:
  - `POST /api/codex/parity/reset`
- Read current runtime mode:
  - `GET /api/codex/runtime-mode`

Parity snapshot includes:
- Diff classification counts: `match|warning|blocking`
- Primary vs secondary success/interrupt/accept/terminal rates
- P95 latency delta (`secondary - primary`)
- Session rebind success rates
- Interrupt convergence rates
- Recent comparison samples

## Go/No-Go Gates (Cutover to `bridge`)
- Blocking diff count <= `CODEX_SHADOW_MAX_BLOCKING_DIFFS` (default `0`)
- P95 latency delta <= `CODEX_SHADOW_MAX_P95_LATENCY_DELTA_MS` (default `1500`)
- Secondary success rate >= baseline:
  - from `CODEX_SHADOW_MIN_SECONDARY_SUCCESS_RATE` if set
  - else baseline = primary success rate in shadow sample

## Failure and Rollback Rules
- If any blocking diff appears repeatedly in core flows (`query|steer|interrupt`), stay in `shadow` or roll back to `legacy`.
- If bridge runtime availability degrades (process flaps, interrupt convergence failures), do not cut to `bridge`.
- Rollback is mode-only:
  - `bridge -> shadow` for investigation
  - `shadow -> legacy` for safe recovery

## Mandatory Verification Scenarios
- Dual tab concurrent submit on same session: only one active turn.
- Steer:
  - succeeds only with matching `expectedTurnId`
  - explicit 409 on missing/mismatch active turn
- Interrupt:
  - converges only on `turn/completed(status=interrupted)`
- Reconnect:
  - `check-session-status` rebinds writer and state
- Session ID rebinding:
  - provisional to actual `sessionId` keeps queue/UI ownership
- Bridge process restart:
  - Node service remains alive, runtime auto-recovers

## Cutover Sequence
1. Run in `shadow` and collect statistically meaningful parity samples.
2. Verify go/no-go gates pass and mandatory scenarios pass.
3. Switch to `bridge`.
4. Monitor for 24h.
5. If blocking issue appears, roll back mode immediately and investigate.
