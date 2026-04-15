"""
End-to-end tests for the Lingzhi Lab CLI.

These tests hit a real running LingzhiLab server and are skipped unless the
LINGZHILAB_E2E (or VIBELAB_E2E) environment variable is set.

Required environment variables when LINGZHILAB_E2E=1:
  LINGZHILAB_URL    Base URL of the running server (default: http://localhost:3001)
  LINGZHILAB_USER   Username to authenticate with
  LINGZHILAB_PASS   Password to authenticate with

Optional:
  CLI_ANYTHING_FORCE_INSTALLED   Set to 1 to use the installed CLI binary
                                 instead of resolving via importlib.

Run:
  LINGZHILAB_E2E=1 LINGZHILAB_USER=admin LINGZHILAB_PASS=secret pytest \\
      cli_anything/vibelab/tests/test_full_e2e.py -v
"""

import importlib
import json
import os
import subprocess
import sys
import tempfile
import unittest

import pytest
import requests

_E2E = os.environ.get("LINGZHILAB_E2E") or os.environ.get("VIBELAB_E2E", "")
_SKIP_REASON = "Set LINGZHILAB_E2E=1 to run end-to-end tests against a live server."

BASE_URL = os.environ.get("LINGZHILAB_URL") or os.environ.get("VIBELAB_URL", "http://localhost:3001")
E2E_USER = os.environ.get("LINGZHILAB_USER") or os.environ.get("VIBELAB_USER", "")
E2E_PASS = os.environ.get("LINGZHILAB_PASS") or os.environ.get("VIBELAB_PASS", "")


# ---------------------------------------------------------------------------
# CLI binary resolver
# ---------------------------------------------------------------------------

def _resolve_cli(name: str) -> str:
    """
    Return the path / invocation string for a CLI entry-point.

    If CLI_ANYTHING_FORCE_INSTALLED is set, assume the package was installed
    into the active environment via pip and the binary is on PATH.

    Otherwise, locate the module via importlib and invoke it with
    `sys.executable -m` to avoid PATH issues in development installs.
    """
    if os.environ.get("CLI_ANYTHING_FORCE_INSTALLED"):
        return name

    # Try to find the entry-point module directly
    try:
        spec = importlib.util.find_spec("cli_anything.lingzhilab.lingzhilab_cli")
        if spec is not None:
            return f"{sys.executable} -m cli_anything.lingzhilab.lingzhilab_cli"
    except (ModuleNotFoundError, ValueError):
        pass

    # Fall back to assuming pip-installed binary is on PATH
    return name


_CLI = _resolve_cli("lingzhilab")


def _run_cli(*args, env=None):
    """
    Run the CLI with the given arguments and return (returncode, stdout, stderr).

    Handles both the "installed binary" form and the "python -m" form returned
    by _resolve_cli().
    """
    if _CLI.startswith(sys.executable):
        # "python /path/to/module.py arg1 arg2" form
        cmd = _CLI.split() + list(args)
    else:
        cmd = [_CLI] + list(args)

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        env={**os.environ, **(env or {})},
        timeout=30,
    )
    return result.returncode, result.stdout, result.stderr


# ---------------------------------------------------------------------------
# Test: auth status (no credentials required)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _E2E, reason=_SKIP_REASON)
class TestAuthStatus(unittest.TestCase):

    def test_auth_status_endpoint_responds(self):
        """GET /api/auth/status should return JSON with needsSetup key."""
        resp = requests.get(f"{BASE_URL}/api/auth/status", timeout=10)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("needsSetup", data)

    def test_auth_status_via_cli(self):
        """lingzhilab auth status should return valid JSON."""
        code, stdout, stderr = _run_cli("--json", "auth", "status")
        self.assertEqual(code, 0, msg=f"stderr: {stderr}")
        data = json.loads(stdout.strip())
        self.assertIn("needsSetup", data)
        self.assertIn("has_local_token", data)


# ---------------------------------------------------------------------------
# Test: full login flow
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _E2E or not E2E_USER or not E2E_PASS, reason=_SKIP_REASON)
class TestLogin(unittest.TestCase):

    def test_login_returns_token(self):
        """POST /api/auth/login with valid credentials should return a token."""
        resp = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": E2E_USER, "password": E2E_PASS},
            timeout=10,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("token", data)
        self.assertTrue(data["token"])

    def test_login_wrong_password(self):
        """POST /api/auth/login with wrong password should return 401."""
        resp = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": E2E_USER, "password": "definitely-wrong-pw-xyz"},
            timeout=10,
        )
        self.assertEqual(resp.status_code, 401)

    def test_login_stores_token_via_session(self):
        """LingzhiLab.login() should persist the token so get_token() finds it."""
        with tempfile.TemporaryDirectory() as tmpdir:
            session_file = os.path.join(tmpdir, ".vibelab_session.json")
            import cli_anything.lingzhilab.core.session as session_mod
            original_path = session_mod.SESSION_FILE
            try:
                from pathlib import Path
                session_mod.SESSION_FILE = Path(session_file)
                from cli_anything.lingzhilab.core.session import LingzhiLab
                client = LingzhiLab(url_override=BASE_URL)
                result = client.login(E2E_USER, E2E_PASS)
                self.assertIn("token", result)
                stored = json.loads(Path(session_file).read_text())
                self.assertEqual(stored["token"], result["token"])
            finally:
                session_mod.SESSION_FILE = original_path


# ---------------------------------------------------------------------------
# Test: list projects (requires auth)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _E2E or not E2E_USER or not E2E_PASS, reason=_SKIP_REASON)
class TestListProjects(unittest.TestCase):

    def setUp(self):
        resp = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": E2E_USER, "password": E2E_PASS},
            timeout=10,
        )
        resp.raise_for_status()
        self.token = resp.json()["token"]

    def test_list_projects_returns_list(self):
        """GET /api/projects should return a list (possibly empty)."""
        resp = requests.get(
            f"{BASE_URL}/api/projects",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=15,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIsInstance(data, (list, dict))

    def test_list_projects_via_module(self):
        """list_projects() against the live server should return a list."""
        with tempfile.TemporaryDirectory() as tmpdir:
            session_file = os.path.join(tmpdir, ".vibelab_session.json")
            import cli_anything.lingzhilab.core.session as session_mod
            from pathlib import Path
            original_path = session_mod.SESSION_FILE
            try:
                session_mod.SESSION_FILE = Path(session_file)
                from cli_anything.lingzhilab.core.session import LingzhiLab
                from cli_anything.lingzhilab.core.projects import list_projects
                client = LingzhiLab(url_override=BASE_URL)
                client.login(E2E_USER, E2E_PASS)
                projects = list_projects(client)
                self.assertIsInstance(projects, list)
            finally:
                session_mod.SESSION_FILE = original_path


# ---------------------------------------------------------------------------
# Test: CLI subprocess
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _E2E, reason=_SKIP_REASON)
class TestCLISubprocess(unittest.TestCase):

    def test_help_flag(self):
        """lingzhilab --help should exit 0 and show usage."""
        code, stdout, stderr = _run_cli("--help")
        self.assertEqual(code, 0, msg=f"stderr: {stderr}")
        combined = stdout + stderr
        self.assertTrue("lingzhilab" in combined.lower() or "vibelab" in combined.lower())

    def test_auth_status_subprocess(self):
        """lingzhilab auth status should exit 0."""
        code, stdout, stderr = _run_cli(
            "--json", "--url", BASE_URL, "auth", "status"
        )
        self.assertEqual(code, 0, msg=f"stderr: {stderr}\nstdout: {stdout}")
        data = json.loads(stdout.strip())
        self.assertIn("needsSetup", data)

    def test_missing_subcommand_shows_help(self):
        """Running with no arguments should show help (exit 0)."""
        code, stdout, stderr = _run_cli()
        # Click returns 0 for the root group with no subcommand
        combined = stdout + stderr
        self.assertIn("Usage", combined)

    def test_auth_group_help(self):
        """lingzhilab auth --help should list subcommands."""
        code, stdout, stderr = _run_cli("auth", "--help")
        self.assertEqual(code, 0)
        combined = stdout + stderr
        self.assertIn("login", combined)
        self.assertIn("logout", combined)
        self.assertIn("status", combined)


if __name__ == "__main__":
    unittest.main()
