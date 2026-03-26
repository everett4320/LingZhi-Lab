# drclaw

A stateful Python CLI for operating Dr. Claw from terminals, automation, and OpenClaw.

It turns Dr. Claw into a controllable research backend so another agent can:
- inspect projects and sessions
- find conversations waiting for user input
- reply into a specific session
- continue, approve, reject, retry, or resume workflows
- summarize project progress and portfolio-wide status
- push compact reports back to mobile / OpenClaw

## What this CLI is for

`drclaw` is the control plane between three layers:
- **Dr. Claw**: the research workspace and server
- **`drclaw` CLI**: the stable machine-facing interface
- **OpenClaw**: the mobile / chat / voice-facing assistant that calls the CLI and reports back to the user

The intended workflow is: the user talks to OpenClaw, OpenClaw runs `drclaw ...`, and Dr. Claw continues execution inside the right project/session.

## Installation

From the Dr. Claw repo root:

```bash
pip install -e ./agent-harness
```

The primary console entrypoint is `drclaw`. The legacy `vibelab` alias is still supported for compatibility during the rename.

Verify installation:

```bash
drclaw --help
drclaw --json projects list
```

## Server and auth setup

Start by checking the local Dr. Claw server:

```bash
drclaw server status
```

If needed:

```bash
drclaw server on
```

Then authenticate:

```bash
drclaw auth login --username <username> --password <password>
```

The token is stored in `~/.drclaw_session.json`. If that file only contains OpenClaw integration fields and no `token`, authenticated commands like `projects list` and `chat waiting` will return `Not logged in`.

## Quick start

```bash
# List projects
drclaw projects list

# Create a new empty workspace project
drclaw projects create /path/to/new-project --name "Demo Project"

# Create a new project from an idea and immediately start discussion
drclaw projects idea /path/to/new-idea-project --name "Idea Project" --idea "Build an OpenClaw-native project secretary for Dr. Claw"

# Inspect the latest conversation state for a project
drclaw --json projects latest <project-ref>

# Inspect project progress and next action
drclaw --json projects progress <project-ref>

# List waiting sessions across all projects
drclaw --json chat waiting

# Reply into a chosen waiting session
drclaw --json chat reply --project <project-ref> --session <session-id> -m "Please continue with the plan and tell me the next decision point."

# Talk to one project session in a project-scoped way
drclaw --json chat project --project <project-ref> --session <session-id> -m "Summarize the current blockers and propose the next three actions."

# Get a cross-project digest for mobile / secretary use
drclaw --json digest portfolio
```

## Project references

Anywhere the CLI accepts `<project-ref>`, you can pass one of:
- the project `name`
- the project `displayName`
- the project filesystem `path` / `fullPath`

For chat and workflow operations, the CLI resolves the real project path before issuing server-side commands.

## Command groups

### Projects

```bash
drclaw --json projects list
drclaw --json projects create /abs/path --name "Display Name"
drclaw --json projects idea /abs/path --name "Display Name" --idea "<idea text>"
drclaw --json projects latest <project-ref>
drclaw --json projects progress <project-ref>
```

Use these for project creation, idea intake, last-message lookup, and progress inspection.

### Sessions and chat

```bash
drclaw --json chat sessions --project <project-ref>
drclaw --json chat waiting
drclaw --json chat waiting --project <project-ref>
# Advanced reply with provider override and auto-approval
drclaw --json chat reply --project <project-ref> --session <session-id> \
  --provider gemini --bypass-permissions --timeout 300 -m "<message>"

drclaw --json chat send --project <project-ref> --provider gemini --bypass-permissions --message "<message>"
drclaw --json chat project --project <project-ref> --session <session-id> -m "<message>"
```

# Advanced Chat Options:
- `--provider [claude|gemini|codex|cursor]`: Force a specific provider. Useful if the original session provider (like Codex) is failing.
- `--bypass-permissions`: Automatically approve all tool calls (like reading/writing files). Essential for non-interactive automation.
- `--timeout <seconds>`: Set a hard wait time. **If omitted, the CLI waits indefinitely (up to 1 hour)** and uses **heartbeat detection** to ensure the session is still active. This is recommended for long-running research tasks.
- `--attach <path>`: Attach a file or image. CLI handles Base64 encoding and MIME detection automatically. Can be repeated.
- `--model <model-id>`: Override the default model used by the provider.

### Workflow / task control

```bash
drclaw --json workflow status --project <project-ref>
drclaw --json workflow continue --project <project-ref> --session <session-id> \
  --provider gemini --bypass-permissions -m "<instruction>"
drclaw --json workflow approve --project <project-ref> --session <session-id>
drclaw --json workflow reject --project <project-ref> --session <session-id> -m "<reason>"
drclaw --json workflow retry --project <project-ref> --session <session-id>
drclaw --json workflow resume --project <project-ref> --session <session-id> --bypass-permissions
drclaw --json taskmaster artifacts --project <project-ref>
```

Use these when the user wants to explicitly control execution rather than just converse with the session.

### Digests and reports

```bash
drclaw --json digest daily
drclaw --json digest project --project <project-ref>
drclaw --json digest portfolio
drclaw --json openclaw report --project <project-ref> --dry-run
drclaw openclaw configure --push-channel feishu:<chat_id>
drclaw openclaw report --project <project-ref>
```

Use `digest portfolio` when OpenClaw needs to answer questions like:
- which projects need attention first
- what experiments are making progress
- which project is waiting for response
- what reply should I send next

## OpenClaw integration

This section is the shortest practical onboarding for a new OpenClaw user.

### 1. What “integration” actually means

You do **not** need a complicated custom API bridge first.

A good first integration simply means:
- OpenClaw can run local `drclaw ...` commands
- OpenClaw can read JSON output
- OpenClaw can summarize that output back to the user

That alone is enough to support project lookup, waiting-session triage, replies, workflow control, and progress digests.

### 2. Minimum prerequisites

Before wiring OpenClaw in, make sure:
- Dr. Claw server is running
- `drclaw` CLI is installed locally
- at least one Dr. Claw project exists
- OpenClaw has local shell / `exec` capability

### 3. First commands to make work

Start with these two commands:

```bash
drclaw --json chat waiting
drclaw --json digest portfolio
```

If OpenClaw can run those and summarize the results, the core integration is already alive.

### 4. Give OpenClaw local exec capability

OpenClaw should be able to execute the CLI directly, for example:

```bash
drclaw --json chat waiting
drclaw --json digest portfolio
drclaw --json chat reply --project <project-ref> --session <session-id> -m "<message>"
drclaw --json workflow continue --project <project-ref> --session <session-id> -m "<instruction>"
```

Prefer direct local CLI execution over building an extra proxy layer.

### 5. One-command install for OpenClaw

Run this once:

```bash
drclaw install --server-url http://localhost:3001
```

That command will:
- copy the full Dr. Claw skill into `~/.openclaw/workspace/skills/drclaw`
- install the wrapper scripts OpenClaw uses for serialized local turns
- save the current Dr. Claw server URL into `~/.drclaw_session.json`
- remember the local `drclaw` executable path for OpenClaw usage

If you also want to save a default push channel during setup:

```bash
drclaw install --server-url http://localhost:3001 --push-channel feishu:<chat_id>
```

The OpenClaw-specific alias is still available:

```bash
drclaw openclaw install --server-url http://localhost:3001
```

### 6. Prefer serialized local turns

When OpenClaw calls local `openclaw agent --local`, use the wrapper script to avoid session-lock collisions:

```bash
agent-harness/skills/dr-claw/scripts/openclaw_drclaw_turn.sh --json -m "Use your exec tool to run `drclaw --json digest portfolio`. Return only the result."
```

### 7. Stable usage pattern for OpenClaw

For reliable automation, prefer single-turn JSON commands instead of interactive shells.

Good patterns:

```bash
drclaw --json chat waiting
drclaw --json projects latest <project-ref>
drclaw --json projects progress <project-ref>
drclaw --json chat reply --project <project-ref> --session <session-id> -m "<message>"
drclaw --json chat project --project <project-ref> --session <session-id> -m "<instruction>"
drclaw --json digest portfolio
```

### 8. Success checklist

A new user should consider the integration complete when OpenClaw can:
- list projects
- find waiting sessions
- reply to one chosen session
- summarize portfolio progress and recommend the next action

## Typical use cases

### A. User asks: what is waiting for response?

```bash
drclaw --json chat waiting
```

OpenClaw should return compact rows with:
- `project`
- `project_display_name`
- `session_id`
- `provider`
- `summary`

### B. User asks OpenClaw to answer one session

```bash
drclaw --json chat reply --project <project-ref> --session <session-id> -m "Please proceed with option B and tell me the next milestone."
drclaw --json chat waiting --project <project-ref>
```

### C. User suddenly has a new idea

```bash
drclaw --json projects idea /absolute/path/to/project --name "Idea Project" --idea "<idea text>"
```

This creates the project, opens the first session, and seeds the initial discussion for refinement.

### D. User asks for cross-project progress and suggestions

```bash
drclaw --json digest portfolio
```

This returns:
- per-project progress summary
- recommendation priority
- recommended action
- session id
- suggested reply

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `DRCLAW_URL` | Server base URL | `http://localhost:3001` |
| `DRCLAW_TOKEN` | Inject token without session file | session file |
| `VIBELAB_URL` | Legacy server base URL (fallback) | `http://localhost:3001` |
| `VIBELAB_TOKEN` | Legacy token (fallback) | session file |

The `--url URL` flag overrides `DRCLAW_URL` and `VIBELAB_URL` for a single invocation.

## Running tests

```bash
python3 -m pytest agent-harness/cli_anything/drclaw/tests/test_core.py -q
PYTHONPATH=agent-harness python3 -m cli_anything.drclaw.drclaw_cli --help
PYTHONPATH=agent-harness python3 -m cli_anything.drclaw.drclaw_cli chat waiting --help
PYTHONPATH=agent-harness python3 -m cli_anything.drclaw.drclaw_cli digest portfolio --help
PYTHONPATH=agent-harness python3 -m cli_anything.drclaw.drclaw_cli workflow continue --help
```
