"""Shared helpers for OpenClaw schema builders used by both CLI and daemon."""

from typing import Any, Dict, List, Optional


def project_label(project: Dict[str, Any]) -> str:
    """Return a human-readable label for a project dict."""
    return str(
        project.get("displayName")
        or project.get("display_name")
        or project.get("name")
        or project.get("fullPath")
        or project.get("path")
        or "unknown"
    )


def compact_message(value: Any, limit: int = 220) -> str:
    """Truncate *value* to *limit* characters, adding ellipsis if needed."""
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 3] + "..."


def compact_waiting_sessions(
    sessions: List[Dict[str, Any]],
    *,
    max_rows: Optional[int] = None,
    compact_messages: bool = False,
) -> List[Dict[str, Any]]:
    """Normalise waiting-session rows into a stable compact form.

    Parameters
    ----------
    max_rows : int | None
        If set, only the first *max_rows* sessions are kept.
    compact_messages : bool
        If ``True``, truncate ``summary`` via :func:`compact_message`.
    """
    rows: List[Dict[str, Any]] = []
    subset = sessions[:max_rows] if max_rows is not None else sessions
    for s in subset:
        summary = s.get("summary") or ""
        if compact_messages:
            summary = compact_message(summary, limit=140)
        rows.append(
            {
                "project": s.get("project"),
                "project_display_name": s.get("project_display_name") or s.get("project"),
                "provider": s.get("provider"),
                "session_id": s.get("session_id"),
                "summary": summary,
                "status": s.get("status") or "waiting_for_response",
                "is_processing": bool(s.get("is_processing", True)),
                "last_activity": (
                    s.get("last_activity")
                    or s.get("lastActivity")
                    or s.get("updatedAt")
                    or ""
                ),
            }
        )
    return rows


def build_project_schema(
    payload: Dict[str, Any],
    *,
    cli_name: str = "lingzhilab",
    extra_actions: Optional[List[Dict[str, Any]]] = None,
    waiting_sessions: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Build an ``openclaw.project.v1`` envelope.

    Parameters
    ----------
    cli_name : str
        CLI binary name used in ``next_actions`` commands.
    extra_actions : list | None
        Additional action dicts appended after the default *Check Status* action.
    waiting_sessions : list | None
        Pre-compacted waiting rows.  When *None*, uses ``payload["waiting"]`` as-is.
    """
    counts = payload.get("counts") or {}
    waiting = payload.get("waiting") or []
    blocked = int(counts.get("blocked", 0) or 0)
    waiting_count = len(waiting)
    overall_state = (
        "attention_needed"
        if blocked or waiting_count
        else ("active" if counts.get("in_progress", 0) else "idle")
    )

    project_ref = payload.get("project") or payload.get("project_path") or ""
    actions: List[Dict[str, Any]] = [
        {
            "id": "status",
            "label": "Check Status",
            "kind": "command",
            "command": f'{cli_name} --json workflow status --project "{project_ref}"',
        }
    ]
    if extra_actions:
        actions.extend(extra_actions)

    return {
        "schema_version": "openclaw.project.v1",
        "kind": "project_digest",
        "project": {
            "ref": payload.get("project"),
            "display_name": payload.get("project_display_name"),
            "path": payload.get("project_path") or "",
            "state": overall_state,
        },
        "status": {
            "workflow": payload.get("status"),
            "updated_at": payload.get("updated_at"),
        },
        "counts": counts,
        "next_task": payload.get("next_task") or {},
        "guidance": payload.get("guidance") or {},
        "waiting_sessions": waiting_sessions if waiting_sessions is not None else waiting,
        "artifacts": payload.get("artifacts") or {},
        "decision": {
            "needed": bool(waiting_count or blocked),
            "reason": "waiting_session" if waiting_count else ("blocked_task" if blocked else None),
        },
        "next_actions": actions,
    }
