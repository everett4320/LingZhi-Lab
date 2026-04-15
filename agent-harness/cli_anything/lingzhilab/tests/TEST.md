# VibeLab CLI Harness - Test Plan

## Unit Tests (`test_core.py`)

All unit tests mock HTTP calls and require no running server.

### `TestSessionFile`

| Test | What It Covers |
|------|---------------|
| `test_login_stores_token` | `VibeLab.login()` writes the JWT and username to `~/.vibelab_session.json` |
| `test_logout_removes_session_file` | `VibeLab.logout()` deletes the session file |
| `test_get_token_reads_session_file` | `get_token()` reads the persisted token from disk |
| `test_get_token_prefers_env_var` | `VIBELAB_TOKEN` env var takes precedence over the session file |
| `test_not_logged_in_error` | Calling `get()` without any token raises `NotLoggedInError` |
| `test_get_base_url_default` | `get_base_url()` returns `http://localhost:3001` when nothing else is set |
| `test_get_base_url_env_var` | `VIBELAB_URL` env var overrides the default |
| `test_get_base_url_override_param` | The `url_override` constructor param takes highest precedence |

### `TestProjects`

| Test | What It Covers |
|------|---------------|
| `test_list_projects_returns_list` | `list_projects()` returns a plain list of dicts |
| `test_list_projects_unwraps_dict` | `list_projects()` unwraps a `{projects: [...]}` server response |
| `test_rename_project_calls_put` | `rename_project()` sends `PUT /api/projects/:projectName/rename` with `{displayName}` |
| `test_add_project_manual_calls_create_endpoint` | `add_project_manual()` sends `POST /api/projects` with `path` and optional `displayName` |
| `test_delete_project_calls_delete` | `delete_project()` sends `DELETE /api/projects/:projectName` and returns True |

### `TestConversations`

| Test | What It Covers |
|------|---------------|
| `test_list_sessions_returns_page` | `list_sessions()` calls the project-scoped sessions endpoint and preserves pagination metadata |
| `test_get_session_messages_returns_messages` | `get_session_messages()` calls the project-scoped messages endpoint and passes `provider`, `limit`, and `offset` |

### `TestTaskMaster`

| Test | What It Covers |
|------|---------------|
| `test_get_summary_hits_server_summary_endpoint` | `get_summary()` uses the dedicated server summary route |
| `test_build_summary_falls_back_to_composed_calls` | `build_summary()` can still compute a stable OpenClaw payload if the summary route is unavailable |

### `TestOutput`

| Test | What It Covers |
|------|---------------|
| `test_output_json_mode_list` | `output()` emits valid JSON when `json_mode=True` |
| `test_output_pretty_mode_list_of_dicts` | `output()` renders column headers in pretty mode |
| `test_output_empty_list` | `output()` handles an empty list without crashing |
| `test_success_json_mode` | `success()` emits `{"status": "ok"}` JSON |
| `test_error_goes_to_stderr` | `error()` writes to stderr, not stdout |
| `test_info_goes_to_stderr` | `info()` writes to stderr, not stdout |
| `test_output_json_mode_dict` | `output()` serializes a plain dict as JSON |

## E2E Tests (`test_full_e2e.py`)

E2E tests are skipped unless `VIBELAB_E2E=1` is set.

### Required environment variables

| Variable | Purpose |
|----------|---------|
| `VIBELAB_E2E` | Set to `1` to enable E2E tests |
| `VIBELAB_URL` | Base URL of the running server (default: `http://localhost:3001`) |
| `VIBELAB_USER` | Username for authentication |
| `VIBELAB_PASS` | Password for authentication |

### CLI subprocess expectations

| Test | What It Tests |
|------|--------------|
| `test_help_flag` | `lingzhilab --help` exits 0 and shows usage |
| `test_auth_status_subprocess` | `lingzhilab --json auth status` exits 0 with JSON output |
| `test_missing_subcommand_shows_help` | Running with no args shows help text |
| `test_auth_group_help` | `lingzhilab auth --help` lists login/logout/status |
