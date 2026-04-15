"""
Daemon management for the Lingzhi Lab Node.js server.

State files (all under ~/.lingzhilab/):
  lingzhilab.pid          — PID of the running server process
  logs/server.log     — combined stdout + stderr from the server

The server is started by running:
  node <server_path>/server/index.js

Where <server_path> is resolved (highest → lowest priority):
  1. path_override passed to start()
  2. "server_path" stored in ~/.lingzhilab_session.json (or ~/.vibelab_session.json)
  3. LINGZHILAB_SERVER_PATH (or VIBELAB_SERVER_PATH) environment variable
  Raises RuntimeError if none of the above is set.
"""

import json
import os
import signal
import subprocess
import time
import warnings
from pathlib import Path
from typing import Optional

from .session import SESSION_FILE, LEGACY_SESSION_FILE, _load_session_file, _save_session_file

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

LINGZHILAB_DIR = Path.home() / ".lingzhilab"
LEGACY_VIBELAB_DIR = Path.home() / ".vibelab"

# Use legacy dir if it exists and new one doesn't
VIBELAB_DIR = LINGZHILAB_DIR
if not LINGZHILAB_DIR.exists() and LEGACY_VIBELAB_DIR.exists():
    VIBELAB_DIR = LEGACY_VIBELAB_DIR

PID_FILE    = VIBELAB_DIR / "lingzhilab.pid"
LEGACY_PID_FILE = VIBELAB_DIR / "vibelab.pid"
LOG_DIR     = VIBELAB_DIR / "logs"
LOG_FILE    = LOG_DIR / "server.log"


def _ensure_dirs() -> None:
    LINGZHILAB_DIR.mkdir(exist_ok=True)
    LOG_DIR.mkdir(exist_ok=True)


# ---------------------------------------------------------------------------
# Server-path resolution
# ---------------------------------------------------------------------------

def _autodetect_server_path() -> Optional[Path]:
    """
    Walk up from this file's location to find a directory containing
    server/index.js.  Works because this module lives inside the LingzhiLab repo:
      <repo>/agent-harness/cli_anything/lingzhilab/core/daemon.py
    """
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "server" / "index.js").exists():
            return parent
    return None


def _resolve_server_path(path_override: Optional[str] = None) -> Path:
    """Return the LingzhiLab installation directory (must contain server/index.js)."""
    candidates = []

    if path_override:
        candidates.append(Path(path_override))

    env_path = os.environ.get("LINGZHILAB_SERVER_PATH") or os.environ.get("VIBELAB_SERVER_PATH")
    if env_path:
        candidates.append(Path(env_path))

    session = _load_session_file()
    stored = session.get("server_path")
    if stored:
        candidates.append(Path(stored))

    # Auto-detect from package location (works for editable installs in-repo)
    auto = _autodetect_server_path()
    if auto:
        candidates.append(auto)

    for p in candidates:
        entry = p / "server" / "index.js"
        if entry.exists():
            return p.resolve()

    raise RuntimeError(
        "Cannot find LingzhiLab server. Pass --path /path/to/LingzhiLab or "
        "set LINGZHILAB_SERVER_PATH."
    )


def _save_server_path(path: Path) -> None:
    """Persist the server path to session file so future invocations find it."""
    data = _load_session_file()
    data["server_path"] = str(path)
    _save_session_file(data)


# ---------------------------------------------------------------------------
# PID helpers
# ---------------------------------------------------------------------------

def _read_pid() -> Optional[int]:
    for f in [PID_FILE, LEGACY_PID_FILE]:
        try:
            return int(f.read_text().strip())
        except (FileNotFoundError, ValueError):
            continue
    return None


def _write_pid(pid: int) -> None:
    PID_FILE.write_text(str(pid))


def _clear_pid() -> None:
    for f in [PID_FILE, LEGACY_PID_FILE]:
        try:
            f.unlink()
        except FileNotFoundError:
            pass


def _pid_alive(pid: int) -> bool:
    """Return True if the process with this PID is running."""
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def server_status() -> dict:
    """
    Return a status dict:
      running  bool
      pid      int | None
      log_file str
      log_tail str   (last 20 lines of log, or '' if no log)
    """
    pid = _read_pid()
    running = pid is not None and _pid_alive(pid)
    if pid is not None and not running:
        _clear_pid()

    tail = ""
    if LOG_FILE.exists():
        lines = LOG_FILE.read_text(errors="replace").splitlines()
        tail = "\n".join(lines[-20:])

    return {
        "running": running,
        "pid": pid if running else None,
        "log_file": str(LOG_FILE),
        "log_tail": tail,
    }


def server_start(path_override: Optional[str] = None, port: Optional[int] = None) -> dict:
    """
    Start the LingzhiLab server as a background daemon.

    Returns a dict with 'pid', 'log_file', and 'server_path'.
    Raises RuntimeError if already running or if server path cannot be found.
    """
    pid = _read_pid()
    if pid is not None and _pid_alive(pid):
        raise RuntimeError(f"Server is already running (PID {pid}).")

    _clear_pid()
    _ensure_dirs()

    server_dir = _resolve_server_path(path_override)
    _save_server_path(server_dir)  # remember for next time

    entry_point = server_dir / "server" / "index.js"
    node_cmd = ["node", str(entry_point)]

    env = os.environ.copy()
    if port:
        env["PORT"] = str(port)

    log_fh = LOG_FILE.open("a")
    log_fh.write(f"\n{'='*60}\n")
    log_fh.write(f"[daemon] Starting server at {_now()}\n")
    log_fh.write(f"[daemon] Command: {' '.join(node_cmd)}\n")
    if port:
        log_fh.write(f"[daemon] PORT={port}\n")
    log_fh.write(f"{'='*60}\n")
    log_fh.flush()

    proc = subprocess.Popen(
        node_cmd,
        cwd=str(server_dir),
        stdout=log_fh,
        stderr=log_fh,
        env=env,
        start_new_session=True,   # detach from terminal
    )

    # Give it a moment and verify it didn't immediately crash
    time.sleep(1.5)
    if proc.poll() is not None:
        log_fh.close()
        raise RuntimeError(
            f"Server exited immediately (code {proc.returncode}). "
            f"Check logs: {LOG_FILE}"
        )

    _write_pid(proc.pid)
    log_fh.close()

    return {
        "pid": proc.pid,
        "log_file": str(LOG_FILE),
        "server_path": str(server_dir),
    }


def server_stop() -> dict:
    """
    Stop the running daemon.

    Returns dict with 'stopped' bool and 'pid'.
    """
    pid = _read_pid()
    if pid is None or not _pid_alive(pid):
        _clear_pid()
        return {"stopped": False, "pid": None, "message": "Server is not running."}

    try:
        os.kill(pid, signal.SIGTERM)
        # Wait up to 5 s for graceful shutdown
        for _ in range(10):
            time.sleep(0.5)
            if not _pid_alive(pid):
                break
        else:
            # Force-kill if it didn't stop
            os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass

    _clear_pid()

    # Append shutdown note to log
    if LOG_FILE.exists():
        with LOG_FILE.open("a") as fh:
            fh.write(f"\n[daemon] Server stopped at {_now()} (PID {pid})\n")

    return {"stopped": True, "pid": pid, "message": f"Server (PID {pid}) stopped."}


def _now() -> str:
    import datetime
    return datetime.datetime.now().isoformat(timespec="seconds")
