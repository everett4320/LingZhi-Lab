"""
Output helpers for the LingzhiLab CLI harness.

Two modes are supported:

* Pretty mode (default): human-readable tables / lists written to stdout via
  Click's echo so that colours work correctly on terminals.
* JSON mode (--json flag): machine-readable JSON written to stdout so that
  callers can pipe output through jq or other tools.

Design goals:
  - Never mix JSON and human text on stdout.
  - All error / diagnostic messages go to stderr so they don't pollute JSON
    output when the --json flag is set.
  - The `output` function is the single entry point for displaying data.
"""

import json
import sys
from typing import Any, List, Optional

import click


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _truncate(value: Any, max_len: int = 60) -> str:
    """Return a string representation of *value* truncated to *max_len* chars."""
    s = str(value) if value is not None else ""
    if len(s) > max_len:
        return s[: max_len - 3] + "..."
    return s


def _render_table(rows: List[dict], title: Optional[str] = None) -> None:
    """Print a pretty ASCII table from a list of dicts."""
    if not rows:
        click.echo("  (no items)")
        return

    # Collect all unique keys in insertion order
    keys: List[str] = []
    for row in rows:
        for k in row:
            if k not in keys:
                keys.append(k)

    # Calculate column widths
    col_widths = {k: len(k) for k in keys}
    for row in rows:
        for k in keys:
            val_len = len(_truncate(row.get(k, ""), 60))
            if val_len > col_widths[k]:
                col_widths[k] = val_len

    sep = "  ".join("-" * col_widths[k] for k in keys)
    header = "  ".join(k.upper().ljust(col_widths[k]) for k in keys)

    if title:
        click.echo(f"\n{title}")
        click.echo("=" * len(title))
    click.echo(header)
    click.echo(sep)
    for row in rows:
        line = "  ".join(_truncate(row.get(k, ""), 60).ljust(col_widths[k]) for k in keys)
        click.echo(line)


def _render_list(items: List[Any], title: Optional[str] = None) -> None:
    """Print a simple bulleted list for non-dict iterables."""
    if title:
        click.echo(f"\n{title}")
        click.echo("=" * len(title))
    if not items:
        click.echo("  (no items)")
        return
    for item in items:
        click.echo(f"  - {item}")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def output(data: Any, json_mode: bool = False, title: Optional[str] = None) -> None:
    """
    Display *data* to stdout.

    Parameters
    ----------
    data:
        The data to display.  Can be a list of dicts, a plain list, a dict,
        or a scalar value.
    json_mode:
        When True, emit compact JSON.  When False, emit a human-readable
        table or list.
    title:
        Optional heading shown above the table in pretty mode (ignored in
        JSON mode).
    """
    if json_mode:
        click.echo(json.dumps(data, default=str))
        return

    if isinstance(data, list):
        if data and isinstance(data[0], dict):
            _render_table(data, title=title)
        else:
            _render_list(data, title=title)
    elif isinstance(data, dict):
        # Render a single dict as a two-column key/value table
        rows = [{"key": k, "value": v} for k, v in data.items()]
        _render_table(rows, title=title)
    else:
        if title:
            click.echo(f"{title}: {data}")
        else:
            click.echo(str(data))


def success(msg: str, json_mode: bool = False) -> None:
    """
    Emit a success message.

    In JSON mode, write ``{"status": "ok", "message": "..."}`` to stdout.
    In pretty mode, write a green-prefixed line to stdout.
    """
    if json_mode:
        click.echo(json.dumps({"status": "ok", "message": msg}))
    else:
        click.echo(click.style("OK  ", fg="green", bold=True) + msg)


def error(msg: str) -> None:
    """
    Emit an error message to stderr (always, regardless of json_mode).

    Does NOT call sys.exit; callers decide whether to abort.
    """
    click.echo(click.style("ERR ", fg="red", bold=True) + msg, err=True)


def info(msg: str) -> None:
    """
    Emit an informational message to stderr.

    Informational messages always go to stderr so they never pollute JSON
    output piped to downstream tools.
    """
    click.echo(click.style("INF ", fg="cyan") + msg, err=True)
