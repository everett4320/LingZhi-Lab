"""
Session / conversation operations against the DrClaw REST API.

Terminology note: DrClaw uses "session" on the server side; the CLI surface
calls these "conversations" to avoid clashing with the HTTP session concept.
"""

from typing import Any, Dict, List, Optional, Union

from .session import DrClaw


SessionPage = Dict[str, Any]
MessagePage = Dict[str, Any]


def _normalize_page(data: Any, item_key: str, limit: Optional[int], offset: Optional[int]) -> Dict[str, Any]:
    """Normalize list-or-dict API responses into a paginated dict shape."""
    if isinstance(data, list):
        return {
            item_key: data,
            "total": len(data),
            "hasMore": False,
            "offset": offset or 0,
            "limit": limit,
        }

    if isinstance(data, dict):
        items = data.get(item_key)
        normalized = dict(data)
        normalized[item_key] = items if isinstance(items, list) else []
        normalized.setdefault("total", len(normalized[item_key]))
        normalized.setdefault("hasMore", False)
        normalized.setdefault("offset", offset or 0)
        normalized.setdefault("limit", limit)
        return normalized

    return {
        item_key: [],
        "total": 0,
        "hasMore": False,
        "offset": offset or 0,
        "limit": limit,
    }


def list_sessions(
    client: DrClaw,
    project_name: str,
    limit: Optional[int] = None,
    offset: Optional[int] = None,
    include_meta: bool = False,
) -> Union[List[Dict[str, Any]], SessionPage]:
    """
    GET /api/projects/:projectName/sessions

    Returns a list of session dicts for the given project. When ``include_meta``
    is True, returns the full paginated response shape from the server.
    """
    params: Dict[str, Any] = {}
    if limit is not None:
        params["limit"] = limit
    if offset is not None:
        params["offset"] = offset

    resp = client.get(f"/api/projects/{project_name}/sessions", params=params or None)
    data = resp.json()
    page = _normalize_page(data, "sessions", limit=limit, offset=offset)
    return page if include_meta else page["sessions"]


def get_session_messages(
    client: DrClaw,
    project_name: str,
    session_id: str,
    limit: Optional[int] = None,
    offset: Optional[int] = None,
    provider: Optional[str] = None,
    include_meta: bool = False,
) -> Union[List[Dict[str, Any]], MessagePage]:
    """
    GET /api/projects/:projectName/sessions/:sessionId/messages

    Returns the ordered list of message dicts for the given session. When
    ``include_meta`` is True, returns the full paginated response shape.
    """
    params: Dict[str, Any] = {}
    if limit is not None:
        params["limit"] = limit
    if offset is not None:
        params["offset"] = offset
    if provider:
        params["provider"] = provider

    resp = client.get(
        f"/api/projects/{project_name}/sessions/{session_id}/messages",
        params=params or None,
    )
    data = resp.json()
    page = _normalize_page(data, "messages", limit=limit, offset=offset)
    return page if include_meta else page["messages"]
