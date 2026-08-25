"""Bounded ``gh`` CLI execution, and the reason Ticketry holds no GitHub token.

Every GitHub call this app makes goes through the user's own ``gh`` login. That
is the whole authentication design: ``gh`` already owns a credential store the
user set up and can revoke, so delegating to it means there is no token for
Ticketry to hold, no place to leak one from, and nothing to migrate when the
user rotates it. Nothing in this module reads, writes, or accepts a
credential — the environment is inherited as the user left it, and if their
``gh`` is not logged in the answer is a refusal, never a prompt.

The bounds mirror :mod:`apps.source_control.clients.git_cli`: one wall-clock timeout, a
byte cap on the output this app will buffer, and a non-interactive environment
so a missing login can never turn into a request waiting on a terminal that is
not there. Output is measured rather than returned — ``gh``'s failures name
remote hosts and echo whatever the API chose to say, so
:mod:`apps.source_control.errors` curates them.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass

from apps.source_control.errors import ProviderTimedOut, ProviderUnavailable

#: Environment variable naming an operator-approved ``gh`` binary, following
#: the same convention as the generator CLIs and the terminal launcher.
APPROVED_PATH_ENV = "MUXED_APPROVED_GH_PATH"

BINARY = "gh"

#: Wall-clock budget for one ``gh`` call. It dials GitHub, so it is longer than
#: a local git read; bounded, because a hung API must not hold a request.
GH_TIMEOUT_SECONDS = 120.0

#: Largest stream this app will buffer from ``gh``. A pull-request URL needs a
#: few hundred bytes; the cap exists so an API that answers with a page of
#: JSON cannot be read into the process without limit.
GH_OUTPUT_LIMIT_BYTES = 64 * 1024


@dataclass(frozen=True)
class GhCompletion:
    """One ``gh`` call's result, judged by its caller rather than here.

    Both streams are carried because the caller has to *classify* the failure —
    an already-open pull request is not the same outcome as a rejected one —
    but neither stream is ever returned to a client.
    """

    exit_code: int
    stdout: str
    stderr: str


def installed_executable() -> str | None:
    """The ``gh`` binary to run, or ``None`` when it is not on this machine."""

    approved = os.environ.get(APPROVED_PATH_ENV, "").strip()
    if approved:
        return approved if os.path.isfile(approved) else None
    return shutil.which(BINARY)


def _environment() -> dict[str, str]:
    """The user's own environment, made non-interactive and colourless.

    Deliberately additive: no variable is removed and none is invented. A token
    in here is the *user's* token, placed there by the user, and this app
    neither reads it nor supplies one of its own.
    """

    env = dict(os.environ)
    env["GH_PAGER"] = "cat"
    env["PAGER"] = "cat"
    env["GH_PROMPT_DISABLED"] = "1"
    env["GH_NO_UPDATE_NOTIFIER"] = "1"
    env["NO_COLOR"] = "1"
    env["CLICOLOR"] = "0"
    env["TERM"] = "dumb"
    return env


def run_gh(
    args: list[str],
    *,
    cwd: str,
    operation: str,
    timeout_seconds: float | None = None,
) -> GhCompletion:
    """Run one ``gh`` command in ``cwd``, or refuse because it cannot be run.

    ``gh`` being absent and ``gh`` exceeding its budget are the two conditions
    no caller can classify better than this layer, so they raise here.
    Everything else — including every kind of API refusal — is handed back as a
    completion, because which failure it is decides which curated sentence the
    user gets.
    """

    executable = installed_executable()
    if executable is None:
        raise ProviderUnavailable()

    budget = GH_TIMEOUT_SECONDS if timeout_seconds is None else timeout_seconds
    try:
        completed = subprocess.run(
            [executable, *args],
            capture_output=True,
            cwd=cwd,
            env=_environment(),
            timeout=budget,
            # A login that is missing must fail, never wait for input.
            stdin=subprocess.DEVNULL,
        )
    except FileNotFoundError as exc:
        raise ProviderUnavailable() from exc
    except subprocess.TimeoutExpired as exc:
        raise ProviderTimedOut(
            operation=operation, timeout_seconds=budget
        ) from exc

    return GhCompletion(
        exit_code=completed.returncode,
        stdout=_capped(completed.stdout),
        stderr=_capped(completed.stderr),
    )


def _capped(raw: bytes | None) -> str:
    return (raw or b"")[:GH_OUTPUT_LIMIT_BYTES].decode("utf-8", errors="replace")
