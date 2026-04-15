"""
Persistent HTTP session for the Lingzhi Lab REST API.

Token and base URL are stored in ~/.lingzhilab_session.json so that a single
`auth login` command is sufficient for a whole shell session (or longer).

Priority for base URL resolution (highest → lowest):
  1. url_override passed directly to LingzhiLab()
  2. LINGZHILAB_URL (or VIBELAB_URL) environment variable
  3. base_url stored in ~/.lingzhilab_session.json (or ~/.vibelab_session.json)
  4. Default: http://localhost:3001

Priority for token resolution (highest → lowest):
  1. LINGZHILAB_TOKEN (or VIBELAB_TOKEN) environment variable
  2. token stored in ~/.lingzhilab_session.json (or ~/.vibelab_session.json)
"""

import json
import os
import stat
import warnings
from pathlib import Path
from typing import Any, Dict, Optional

import requests

SESSION_FILE = Path.home() / ".lingzhilab_session.json"
LEGACY_SESSION_FILE = Path.home() / ".vibelab_session.json"
DEFAULT_BASE_URL = "http://localhost:3001"


class NotLoggedInError(Exception):
    """Raised when a token is required but none is available."""

    def __init__(self) -> None:
        super().__init__(
            "Not logged in. Run `lingzhilab auth login` first, "
            "or set the LINGZHILAB_TOKEN environment variable."
        )


def _load_session_file(session_file: Optional[Path] = None) -> Dict[str, Any]:
    """Return the parsed session file, or an empty dict if it doesn't exist."""
    session_path = session_file or SESSION_FILE
    if not session_path.exists() and not session_file and LEGACY_SESSION_FILE.exists():
        session_path = LEGACY_SESSION_FILE

    try:
        with session_path.open("r") as fh:
            return json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_session_file(data: Dict[str, Any], session_file: Optional[Path] = None) -> None:
    """Persist session data to disk with restrictive permissions (0600)."""
    session_path = session_file or SESSION_FILE
    session_path.write_text(json.dumps(data, indent=2))
    session_path.chmod(stat.S_IRUSR | stat.S_IWUSR)


def _delete_session_file(session_file: Optional[Path] = None) -> None:
    """Remove the session file if it exists."""
    session_path = session_file or SESSION_FILE
    try:
        session_path.unlink()
    except FileNotFoundError:
        pass

    # Also clean up legacy file if it exists and we're not using a custom path
    if not session_file:
        try:
            LEGACY_SESSION_FILE.unlink()
        except FileNotFoundError:
            pass


class LingzhiLab:
    """
    Thin wrapper around requests that handles authentication headers and
    base-URL resolution for all Lingzhi Lab API calls.
    """

    def __init__(self, url_override: Optional[str] = None) -> None:
        self._url_override = url_override
        self._session = requests.Session()
        self._session.headers.update({"Content-Type": "application/json"})

    # ------------------------------------------------------------------
    # URL / token resolution
    # ------------------------------------------------------------------

    def get_base_url(self) -> str:
        if self._url_override:
            return self._url_override.rstrip("/")
        env_url = os.environ.get("LINGZHILAB_URL") or os.environ.get("VIBELAB_URL")
        if env_url:
            return env_url.rstrip("/")
        session_data = _load_session_file()
        if session_data.get("base_url"):
            return session_data["base_url"].rstrip("/")
        return DEFAULT_BASE_URL

    def get_token(self) -> Optional[str]:
        env_token = os.environ.get("LINGZHILAB_TOKEN") or os.environ.get("VIBELAB_TOKEN")
        if env_token:
            return env_token
        return _load_session_file().get("token")

    def _require_token(self) -> str:
        token = self.get_token()
        if not token:
            raise NotLoggedInError()
        return token

    def _auth_headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self._require_token()}"}

    def _url(self, path: str) -> str:
        return f"{self.get_base_url()}/{path.lstrip('/')}"

    # ------------------------------------------------------------------
    # Auth operations
    # ------------------------------------------------------------------

    def login(self, username: str, password: str) -> Dict[str, Any]:
        """
        POST /api/auth/login.  On success, persist the token and base URL to
        the session file and return the server response dict.
        """
        resp = self._session.post(
            self._url("/api/auth/login"),
            json={"username": username, "password": password},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        if "token" in data:
            session_data = _load_session_file()
            session_data["token"] = data["token"]
            session_data["base_url"] = self.get_base_url()
            session_data["username"] = data.get("user", {}).get("username", username)
            _save_session_file(session_data)
        return data

    def logout(self) -> None:
        """Remove the local session file (JWT is stateless on the server)."""
        _delete_session_file()

    # ------------------------------------------------------------------
    # HTTP verbs — all require authentication
    # ------------------------------------------------------------------

    def get(self, path: str, **kwargs) -> requests.Response:
        resp = self._session.get(
            self._url(path),
            headers=self._auth_headers(),
            timeout=30,
            **kwargs,
        )
        resp.raise_for_status()
        return resp

    def post(self, path: str, body: Optional[Dict[str, Any]] = None, **kwargs) -> requests.Response:
        resp = self._session.post(
            self._url(path),
            headers=self._auth_headers(),
            json=body or {},
            timeout=30,
            **kwargs,
        )
        resp.raise_for_status()
        return resp

    def delete(self, path: str, **kwargs) -> requests.Response:
        resp = self._session.delete(
            self._url(path),
            headers=self._auth_headers(),
            timeout=30,
            **kwargs,
        )
        resp.raise_for_status()
        return resp

    def patch(self, path: str, body: Optional[Dict[str, Any]] = None, **kwargs) -> requests.Response:
        resp = self._session.patch(
            self._url(path),
            headers=self._auth_headers(),
            json=body or {},
            timeout=30,
            **kwargs,
        )
        resp.raise_for_status()
        return resp

    def put(self, path: str, body: Optional[Dict[str, Any]] = None, **kwargs) -> requests.Response:
        resp = self._session.put(
            self._url(path),
            headers=self._auth_headers(),
            json=body or {},
            timeout=30,
            **kwargs,
        )
        resp.raise_for_status()
        return resp

    # ------------------------------------------------------------------
    # Unauthenticated helper
    # ------------------------------------------------------------------

    def get_unauthenticated(self, path: str, **kwargs) -> requests.Response:
        """GET without requiring a token — used for auth status checks."""
        resp = self._session.get(
            self._url(path),
            timeout=15,
            **kwargs,
        )
        resp.raise_for_status()
        return resp


# Alias for backward compatibility
class VibeLab(LingzhiLab):
    def __init__(self, *args, **kwargs):
        warnings.warn(
            "VibeLab class is deprecated; use LingzhiLab instead.",
            DeprecationWarning,
            stacklevel=2
        )
        super().__init__(*args, **kwargs)
