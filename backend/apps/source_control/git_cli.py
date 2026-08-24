"""Bounded ``git`` CLI execution for the source-control surface.

Every git invocation in this app goes through this module. It shells out to
the ``git`` binary rather than binding a library (T3 audit, decision 1), and
it is the single place that enforces the three properties the surface depends
on:

* ``LC_ALL=C`` plus ``core.quotepath=false`` so parsed output is stable
  regardless of the developer's locale;
* a wall-clock timeout, so a wedged filter or hook cannot hang a request;
* a byte cap on the output this app will return or parse, so a
  repository-sized diff cannot cross the wire and a status too large to read
  is refused rather than reported as if it were complete. (The cap bounds what
  callers receive, not git's own peak output.)

:func:`run_git` judges the exit code here, turning non-zero exits and timeouts
into :mod:`apps.source_control.errors` failures that carry stream *lengths*,
never stream contents. :func:`run_git_capturing` leaves that judgement to its
caller, for the one mutation whose failure the user has to read.
"""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass

from apps.source_control.errors import GitFailed, GitTimedOut, GitUnavailable


#: Wall-clock budget for one read-only git command.
DEFAULT_TIMEOUT_SECONDS = 30.0

#: Largest stdout this app will buffer from one git command.
DEFAULT_OUTPUT_LIMIT_BYTES = 1_000_000

# Applied before the subcommand so no repository config can re-enable colour,
# external diff drivers, or textconv filters for output we are about to parse.
_SAFE_CONFIG = (
    "-c", "core.quotepath=false",
    "-c", "color.ui=false",
)


@dataclass(frozen=True)
class GitOutput:
    """Captured stdout for one command, with the cap's verdict attached."""

    stdout: str
    #: True when stdout hit the byte cap and the tail was dropped.
    truncated: bool


@dataclass(frozen=True)
class GitCompletion:
    """One command's full result, for a caller that judges the exit itself."""

    exit_code: int
    stdout: str
    stderr: str
    #: True when either stream hit the byte cap and its tail was dropped.
    truncated: bool


def _environment() -> dict[str, str]:
    env = dict(os.environ)
    env["LC_ALL"] = "C"
    env["GIT_OPTIONAL_LOCKS"] = "0"
    # A review read must never stop for credentials or an editor.
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_PAGER"] = "cat"
    return env


def run_git(
    args: list[str],
    *,
    cwd: str,
    operation: str,
    timeout_seconds: float | None = None,
    output_limit_bytes: int | None = None,
    allowed_exit_codes: tuple[int, ...] = (0,),
) -> GitOutput:
    """Run one git command in ``cwd`` under this app's bounds.

    ``operation`` names the read for the user-facing failure sentence; it is
    the only part of a failure that describes what was attempted. An exit code
    outside ``allowed_exit_codes`` becomes :class:`GitFailed`, whose payload
    carries stream *lengths* only.
    """

    completion = run_git_capturing(
        args,
        cwd=cwd,
        operation=operation,
        timeout_seconds=timeout_seconds,
        output_limit_bytes=output_limit_bytes,
    )
    if completion.exit_code not in allowed_exit_codes:
        raise GitFailed(
            operation=operation,
            exit_code=completion.exit_code,
            stderr_bytes=len(completion.stderr.encode("utf-8", errors="replace")),
        )
    return GitOutput(stdout=completion.stdout, truncated=completion.truncated)


def run_git_capturing(
    args: list[str],
    *,
    cwd: str,
    operation: str,
    timeout_seconds: float | None = None,
    output_limit_bytes: int | None = None,
) -> GitCompletion:
    """Run one git command and hand back its exit code and both streams.

    The bounds are the same as :func:`run_git`; what differs is who judges the
    result. A mutation whose failure the user must *read* — a rejected commit,
    where the repository's hooks wrote the only useful explanation — cannot let
    this layer collapse the outcome into a curated sentence, so it takes the
    streams and decides for itself. Read paths should prefer :func:`run_git`.
    """

    if timeout_seconds is None:
        timeout_seconds = DEFAULT_TIMEOUT_SECONDS
    if output_limit_bytes is None:
        output_limit_bytes = DEFAULT_OUTPUT_LIMIT_BYTES

    try:
        completed = subprocess.run(
            ["git", "-C", cwd, *_SAFE_CONFIG, *args],
            capture_output=True,
            env=_environment(),
            timeout=timeout_seconds,
        )
    except FileNotFoundError as exc:
        raise GitUnavailable() from exc
    except subprocess.TimeoutExpired as exc:
        raise GitTimedOut(
            operation=operation, timeout_seconds=timeout_seconds
        ) from exc

    stdout, truncated = _capped(completed.stdout, output_limit_bytes)
    stderr, stderr_truncated = _capped(completed.stderr, output_limit_bytes)
    return GitCompletion(
        exit_code=completed.returncode,
        stdout=stdout,
        stderr=stderr,
        truncated=truncated or stderr_truncated,
    )


def _capped(raw: bytes | None, limit_bytes: int) -> tuple[str, bool]:
    """Decode at most ``limit_bytes`` of one stream, reporting the cut."""

    data = raw or b""
    truncated = len(data) > limit_bytes
    if truncated:
        data = data[:limit_bytes]
    return data.decode("utf-8", errors="replace"), truncated
