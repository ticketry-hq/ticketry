"""One bounded GitHub lookup for a stored pull request state."""

from __future__ import annotations

import json
import re
from pathlib import Path

from apps.source_control.errors import (
    ProviderLookupFailed,
    ProviderNotAuthenticated,
    ProviderResponseMalformed,
    PullRequestNotFound,
    PullRequestUrlUnsupported,
)
from apps.source_control.gh_cli import run_gh
from apps.source_control.models import PR_CLOSED, PR_MERGED, PR_OPEN

_SUPPORTED_URL = re.compile(
    r"^https://github\.com/[^/?#]+/[^/?#]+/pull/[1-9][0-9]*(?:[/?#].*)?$"
)
_STATE_MAP = {
    "OPEN": PR_OPEN,
    "MERGED": PR_MERGED,
    "CLOSED": PR_CLOSED,
}
_AUTH_FAILURE_MARKERS = (
    "authentication failed",
    "bad credentials",
    "gh auth login",
    "http 401",
    "not logged",
)
_NOT_FOUND_MARKERS = (
    "could not resolve to a pullrequest",
    "http 404",
    "not found",
)
_BACKEND_DIR = Path(__file__).resolve().parents[2]


def lookup_pull_request_state(pr_url: str | None) -> str:
    """Return open, merged, or closed after exactly one supported lookup."""

    if not pr_url or _SUPPORTED_URL.fullmatch(pr_url) is None:
        raise PullRequestUrlUnsupported()

    completion = run_gh(
        ["pr", "view", pr_url, "--json", "state"],
        cwd=str(_BACKEND_DIR),
        operation="the pull request state",
    )
    if completion.exit_code != 0:
        failure_text = f"{completion.stdout}\n{completion.stderr}".lower()
        if any(marker in failure_text for marker in _AUTH_FAILURE_MARKERS):
            raise ProviderNotAuthenticated()
        if any(marker in failure_text for marker in _NOT_FOUND_MARKERS):
            raise PullRequestNotFound()
        raise ProviderLookupFailed()

    try:
        payload = json.loads(completion.stdout)
        state = payload["state"]
    except (json.JSONDecodeError, KeyError, TypeError):
        raise ProviderResponseMalformed() from None

    if not isinstance(state, str) or state.upper() not in _STATE_MAP:
        raise ProviderResponseMalformed()
    return _STATE_MAP[state.upper()]
