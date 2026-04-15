# Lingzhi Lab CLI Harness - Standard Operating Procedure

## Overview

VibeLab, now also branded as Lingzhi Lab, is a full-stack AI research workspace for managing multi-provider coding and research sessions. The Python `lingzhilab` CLI exposes the same server capabilities for automation, OpenClaw integration, mobile status reporting, and structured OpenClaw-ready schemas.

## Core workflows

### Authentication

```bash
lingzhilab auth status
lingzhilab auth login --username admin --password s3cr3t
lingzhilab auth logout
```

### Projects

```bash
lingzhilab projects list
lingzhilab projects add /absolute/path/to/project --name "My Project"
lingzhilab projects rename <project-ref> "New Display Name"
lingzhilab projects delete <project-ref>
```

`<project-ref>` may be a project `name`, `displayName`, or filesystem path.

### Sessions and chat

```bash
lingzhilab sessions list <project-ref>
lingzhilab sessions list <project-ref> --provider cursor --limit 20 --offset 0
lingzhilab sessions messages <project-ref> <session-id> --provider claude --limit 100
lingzhilab chat sessions --project <project-ref>
lingzhilab chat send --project <project-ref> --message "What changed?"
lingzhilab chat send --project <project-ref> --session <session-id> --message "Continue"
lingzhilab --json chat reply --project <project-ref> --session <session-id> -m "Continue and tell me the next checkpoint"
```

`chat send` resolves the project reference to a real filesystem path before opening the websocket, and waits for explicit completion events instead of using a silence timeout.

For machine-facing clients, `chat send`, `chat reply`, `workflow continue`, and `workflow resume` now embed `openclaw.turn.v1` under the top-level `openclaw` field.

### TaskMaster / pipeline progress

```bash
lingzhilab taskmaster status
lingzhilab taskmaster detect <project-ref>
lingzhilab taskmaster detect-all
lingzhilab taskmaster init <project-ref>
lingzhilab taskmaster tasks <project-ref>
lingzhilab taskmaster next <project-ref>
lingzhilab taskmaster next-guidance <project-ref>
lingzhilab taskmaster summary <project-ref>
```

The server now also exposes a dedicated summary route, so OpenClaw and other agents can fetch one stable progress payload instead of stitching together multiple endpoints.

### OpenClaw / mobile reporting

```bash
lingzhilab openclaw install
lingzhilab openclaw configure --push-channel feishu:<chat_id>
lingzhilab openclaw report --project <project-ref> --dry-run
lingzhilab openclaw report --project <project-ref>
lingzhilab openclaw-watch on --interval 30
lingzhilab openclaw-watch status
lingzhilab openclaw-watch off
```

`openclaw report` generates a concise status digest with counts, next task, required inputs, suggested skills, and optional next-action prompt text.

`openclaw-watch` runs as a background daemon and subscribes to Lingzhi Lab WebSocket events so OpenClaw can receive event-driven notifications instead of polling digest commands. It now resolves the affected project, compares workflow snapshots, derives higher-level signals such as `blocker_detected`, `waiting_for_human`, and `task_completed`, and asks OpenClaw agent to write the final Lark/Feishu summary.

## OpenClaw schema contract

Major JSON commands now include a top-level `openclaw` field with a stable versioned payload:

- `openclaw.turn.v1`
- `openclaw.project.v1`
- `openclaw.portfolio.v1`
- `openclaw.daily.v1`
- `openclaw.report.v1`
- `openclaw.event.v1`

Formal schema reference:

```bash
cat agent-harness/cli_anything/lingzhilab/SCHEMA.md
```

## Server contract notes

Important server routes used by the CLI:

- `GET /api/projects`
- `POST /api/projects`
- `PUT /api/projects/:projectName/rename`
- `GET /api/projects/:projectName/sessions`
- `GET /api/projects/:projectName/sessions/:sessionId/messages`
- `GET /api/taskmaster/installation-status`
- `GET /api/taskmaster/detect/:projectName`
- `GET /api/taskmaster/detect-all`
- `POST /api/taskmaster/initialize/:projectName`
- `GET /api/taskmaster/tasks/:projectName`
- `GET /api/taskmaster/next/:projectName`
- `GET /api/taskmaster/next-guidance/:projectName`
- `GET /api/taskmaster/summary/:projectName`
- WebSocket: `/ws?token=<jwt>`

## JSON mode

Use `--json` whenever OpenClaw or another agent needs machine-readable output:

```bash
lingzhilab --json projects list
lingzhilab --json sessions list <project-ref> --provider codex
lingzhilab --json taskmaster summary <project-ref>
lingzhilab --json openclaw report --project <project-ref> --dry-run
lingzhilab --json workflow status --project <project-ref>
lingzhilab --json digest portfolio
lingzhilab --json chat watch --event claude-permission-request --event taskmaster-project-updated
```

Guidance:

- Prefer the embedded `openclaw` field over parsing natural-language `reply`
- Use `decision.needed` and `next_actions` for mobile quick actions
- Use `openclaw-watch` when proactive notifications are needed
- For watcher-driven notifications, prefer `event.signals` over raw websocket event names
