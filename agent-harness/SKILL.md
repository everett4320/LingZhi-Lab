---
name: lingzhilab
description: Lingzhi Lab workspace skill for project lookup, session inspection, TaskMaster progress, OpenClaw structured schema, and event-driven reporting
---

# Lingzhi Lab Research Skill

Use this skill when the user asks about Lingzhi Lab projects, wants to inspect Claude/Cursor/Codex/Gemini sessions, needs task progress pushed to OpenClaw/mobile, or wants structured OpenClaw-ready JSON outputs.

## Setup check

Before using Lingzhi Lab, verify the server is reachable:

```bash
lingzhilab server status
```

If needed, start it:

```bash
lingzhilab server on
```

## Project discovery

```bash
lingzhilab --json projects list
```

Project references accepted by the CLI:

- `name`
- `displayName`
- filesystem `path` / `fullPath`

If a path exists locally but is not registered yet:

```bash
lingzhilab projects add /absolute/path/to/project --name "Display Name"
```

## Session workflows

List sessions:

```bash
lingzhilab --json sessions list <project-ref>
lingzhilab --json sessions list <project-ref> --provider cursor
```

Fetch messages:

```bash
lingzhilab --json sessions messages <project-ref> <session-id> --provider claude --limit 100
```

Send Claude a message:

```bash
lingzhilab --json chat send --project <project-ref> --message "<user message>"
```

Reply to an existing session with structured OpenClaw output:

```bash
lingzhilab --json chat reply --project <project-ref> --session <session-id> -m "<user message>"
```

List active sessions across projects:

```bash
lingzhilab --json chat sessions
```

## TaskMaster workflows

Check whether TaskMaster is present:

```bash
lingzhilab --json taskmaster detect <project-ref>
```

Get progress and next action:

```bash
lingzhilab --json taskmaster summary <project-ref>
lingzhilab --json taskmaster next-guidance <project-ref>
```

Initialize `.pipeline` for a project if needed:

```bash
lingzhilab taskmaster init <project-ref>
```

## OpenClaw / mobile reporting

Configure the default push channel once:

```bash
lingzhilab openclaw configure --push-channel feishu:<chat_id>
```

Preview a mobile report:

```bash
lingzhilab --json openclaw report --project <project-ref> --dry-run
```

Send it:

```bash
lingzhilab openclaw report --project <project-ref>
```

Start the event-driven watcher daemon:

```bash
lingzhilab --json openclaw-watch on --to feishu:<chat_id>
lingzhilab --json openclaw-watch status
lingzhilab --json openclaw-watch off
```

The watcher is now a useful notification pipeline rather than raw websocket forwarding. It:
- subscribes to Lingzhi Lab WebSocket events
- resolves the concrete project when possible
- compares workflow snapshots to derive higher-level signals
- deduplicates repeated notifications with a stable signature and 6-hour TTL
- asks OpenClaw agent to generate the final Feishu/Lark summary through `--deliver`
- falls back to a direct bridge push if agent summarization fails

Current attention-worthy signals include:
- `human_decision_needed`
- `waiting_for_human`
- `blocker_detected`
- `blocker_cleared`
- `task_completed`
- `next_task_changed`
- `attention_needed`
- `session_aborted`

Watcher runtime files:
- state: `~/.lingzhilab/openclaw-watcher-state.json`
- log: `~/.lingzhilab/logs/openclaw-watcher.log`

## Structured OpenClaw schema

Major JSON commands now include a top-level `openclaw` field with a stable versioned schema for mobile / voice clients.

Current schema families:

- `openclaw.turn.v1`
- `openclaw.project.v1`
- `openclaw.portfolio.v1`
- `openclaw.daily.v1`
- `openclaw.report.v1`
- `openclaw.event.v1`

Practical client rules:
- prefer `decision.needed` over guessing whether to interrupt the user
- prefer `next_actions` for quick actions and voice suggestions
- prefer `turn.summary` or portfolio `focus` for compact rendering
- for watcher events, read `openclaw.event.v1.event.signals` first instead of raw `type`

Formal contract:

```bash
cat agent-harness/cli_anything/lingzhilab/SCHEMA.md
```

## Recommended operating flow

1. If the user did not specify a project, run `projects list` and resolve the project first.
2. For freeform project questions, use `chat send` or `chat reply`, and prefer the `openclaw` schema field over parsing raw reply text.
3. For status/progress questions, prefer `workflow status`, `digest project`, `digest portfolio`, and `taskmaster next-guidance`.
4. For proactive mobile updates, use `openclaw report`.
5. For background attention monitoring, use `openclaw-watch on` instead of polling digest commands manually.
