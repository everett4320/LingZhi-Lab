"""
Settings / API key management operations against the LingzhiLab REST API.
"""

from typing import Any, Dict, List

from .session import LingzhiLab


def list_api_keys(client: LingzhiLab) -> List[Dict[str, Any]]:
    """
    GET /api/settings/api-keys

    Returns a list of API key dicts.  The server truncates the actual key
    value to the first 10 characters followed by "..." for security.
    """
    resp = client.get("/api/settings/api-keys")
    data = resp.json()
    if isinstance(data, list):
        return data
    return data.get("apiKeys", data)


def create_api_key(client: LingzhiLab, key_name: str) -> Dict[str, Any]:
    """
    POST /api/settings/api-keys

    Creates a new API key with the given display name.  Returns the created
    key dict including the full ``api_key`` value (only visible on creation).
    """
    resp = client.post("/api/settings/api-keys", {"keyName": key_name})
    data = resp.json()
    # Server returns { success: true, apiKey: {...} }
    return data.get("apiKey", data)


def delete_api_key(client: LingzhiLab, key_id: str) -> bool:
    """
    DELETE /api/settings/api-keys/:keyId

    Returns True on success, raises on HTTP error.
    """
    resp = client.delete(f"/api/settings/api-keys/{key_id}")
    return resp.json().get("success", True)
