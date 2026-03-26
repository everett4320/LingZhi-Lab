"""
Project-level operations against the DrClaw REST API.

All functions accept a `DrClaw` client instance as their first argument so
that callers control authentication and URL resolution.
"""

from pathlib import Path
from typing import Any, Dict, List, Optional

from .session import DrClaw


def list_projects(client: DrClaw) -> List[Dict[str, Any]]:
    """
    GET /api/projects

    Returns a list of project dicts as returned by the server. Each dict
    typically includes keys such as ``name``, ``displayName``, ``path``, and
    provider-specific session metadata.
    """
    resp = client.get("/api/projects")
    data = resp.json()
    if isinstance(data, list):
        return data
    return data.get("projects", data)


def rename_project(client: DrClaw, project_name: str, new_name: str) -> bool:
    """
    PUT /api/projects/:projectName/rename

    Returns True on success, raises on HTTP error.
    """
    resp = client.put(
        f"/api/projects/{project_name}/rename",
        {"displayName": new_name},
    )
    return resp.json().get("success", True)


def delete_project(client: DrClaw, project_id: str) -> bool:
    """
    DELETE /api/projects/:id

    Returns True on success, raises on HTTP error.
    """
    resp = client.delete(f"/api/projects/{project_id}")
    data = resp.json()
    return data.get("success", True)


def add_project_manual(
    client: DrClaw,
    path: str,
    display_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    POST /api/projects

    Registers a filesystem path as a new project and returns the created
    project dict.
    """
    body: Dict[str, Any] = {"path": path}
    if display_name is not None:
        body["displayName"] = display_name

    resp = client.post("/api/projects", body)
    data = resp.json()
    if isinstance(data, dict) and isinstance(data.get("project"), dict):
        return data["project"]
    return data


def create_project_workspace(
    client: DrClaw,
    path: str,
    display_name: Optional[str] = None,
    github_url: Optional[str] = None,
) -> Dict[str, Any]:
    """
    POST /api/projects/create-workspace

    Creates a new workspace directory (or clones a repo) and registers it as a
    DrClaw project. Returns the created project dict.
    """
    body: Dict[str, Any] = {
        "workspaceType": "new",
        "path": path,
    }
    if display_name is not None:
        body["displayName"] = display_name
    if github_url is not None:
        body["githubUrl"] = github_url

    resp = client.post("/api/projects/create-workspace", body)
    data = resp.json()
    if isinstance(data, dict) and isinstance(data.get("project"), dict):
        return data["project"]
    return data


def create_idea_project(
    client: DrClaw,
    workspace_path: str,
    display_name: Optional[str] = None,
    idea: Optional[str] = None,
    provider: str = "claude",
    timeout: Optional[int] = None,
    attachments: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    """
    Create a new workspace-backed project and optionally seed it with an idea
    using the chat pipeline.
    """
    project = create_project_workspace(client, workspace_path, display_name=display_name)

    if not idea:
        return {"project": project, "seeded": False}

    from .chat import send_message

    prompt = (
        "You are helping the user shape a fresh project idea into an actionable plan. "
        "First restate the idea briefly, then ask 3 focused clarifying questions, "
        "and finally propose a first execution plan with concrete next steps.\n\n"
        f"Idea:\n{idea.strip()}"
    )
    reply = send_message(
        client,
        project_path=project.get("fullPath") or project.get("path") or workspace_path,
        message=prompt,
        provider=provider,
        session_id=None,
        timeout=timeout,
        attachments=attachments,
    )
    return {"project": project, "seeded": True, "chat": reply}


def get_project_latest_message(
    client: DrClaw,
    project: Dict[str, Any],
    provider: Optional[str] = None,
) -> Dict[str, Any]:
    """Return the newest known session snapshot for a project."""
    provider_filter = (provider or '').strip().lower()
    collections = [
        ("claude", project.get("sessions") or []),
        ("cursor", project.get("cursorSessions") or []),
        ("codex", project.get("codexSessions") or []),
        ("gemini", project.get("geminiSessions") or []),
    ]

    candidates: List[Dict[str, Any]] = []
    for collection_provider, sessions in collections:
        if provider_filter and collection_provider != provider_filter:
            continue
        if not isinstance(sessions, list):
            continue
        for session in sessions:
            if not isinstance(session, dict):
                continue
            row = dict(session)
            row.setdefault("provider", collection_provider)
            row.setdefault("project_name", project.get("name"))
            row.setdefault("project_display_name", project.get("displayName") or project.get("display_name") or project.get("name"))
            row.setdefault("project_path", project.get("fullPath") or project.get("path") or "")
            candidates.append(row)

    def timestamp_key(item: Dict[str, Any]) -> str:
        for key in ("lastActivity", "lastModified", "updatedAt", "createdAt", "timestamp"):
            value = item.get(key)
            if isinstance(value, str) and value:
                return value
        return ""

    if not candidates:
        return {
            "project": project.get("name"),
            "project_display_name": project.get("displayName") or project.get("display_name") or project.get("name"),
            "project_path": project.get("fullPath") or project.get("path") or "",
            "session": None,
        }

    candidates.sort(key=timestamp_key, reverse=True)
    latest = candidates[0]
    return {
        "project": project.get("name"),
        "project_display_name": project.get("displayName") or project.get("display_name") or project.get("name"),
        "project_path": project.get("fullPath") or project.get("path") or "",
        "session": {
            "session_id": latest.get("session_id") or latest.get("sessionId") or latest.get("id") or "",
            "provider": latest.get("provider") or provider_filter or "claude",
            "summary": latest.get("summary") or latest.get("title") or latest.get("name") or "",
            "last_activity": timestamp_key(latest),
            "last_user_message": latest.get("lastUserMessage") or "",
            "last_assistant_message": latest.get("lastAssistantMessage") or "",
            "message_count": latest.get("messageCount"),
        },
    }
