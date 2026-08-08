"""Small trust-boundary helpers for provider-controlled Chat diagnostics."""

from __future__ import annotations

import re
from typing import Any


MAX_DIAGNOSTIC_CHARS = 2_048
MAX_STDERR_LINE_CHARS = 512
REDACTED = "[REDACTED]"

_ASSIGNMENT_SECRET = re.compile(
    r"(?ix)"
    r"(?P<prefix>"
    # Environment-style identifiers often namespace or compound the sensitive
    # segment (for example AWS_SECRET_ACCESS_KEY or MUXED_SECRET_KEY). Match
    # complete underscore/hyphen-delimited identifiers around that segment,
    # while still accepting the provider APIs' camelCase spellings.
    r"(?:[a-z0-9]+[_-])*"
    r"(?:authorization|api[_-]?key|access[_-]?(?:token|key(?:[_-]?id)?)|"
    r"auth[_-]?token|token|secret|private[_-]?key|password|passwd|credential)"
    r"(?:[_-][a-z0-9]+)*"
    r"\s*[\"']?\s*[:=]\s*[\"']?"
    r"(?:bearer\s+)?"
    r")"
    # Fail closed for unquoted multi-word values. Provider diagnostics have no
    # reliable way to distinguish the end of such a secret before a structural
    # delimiter, so redact the remainder of that field/line.
    r"(?P<value>[^\r\n,;]+)"
)
_BEARER_SECRET = re.compile(r"(?i)(\bbearer\s+)[A-Za-z0-9._~+/=-]+")
_SECRET_KEY_NAMES = frozenset(
    {
        "apikey",
        "authorization",
        "cookie",
        "credential",
        "credentials",
        "password",
        "passwd",
        "secret",
        "setcookie",
        "token",
    }
)


def _is_secret_key(value: object) -> bool:
    normalized = re.sub(r"[^a-z0-9]", "", str(value).casefold())
    if normalized in _SECRET_KEY_NAMES:
        return True
    if any(
        marker in normalized
        for marker in ("authorization", "credential", "password", "secret")
    ):
        return True
    return normalized.endswith(
        (
            "accesskey",
            "apikey",
            "authorization",
            "cookie",
            "credential",
            "password",
            "privatekey",
            "secret",
            "token",
        )
    )


def sanitize_external_message(
    value: object,
    *,
    max_chars: int = MAX_DIAGNOSTIC_CHARS,
) -> str:
    """Redact common credential forms and bound provider-controlled text."""

    text = str(value or "")
    text = "".join(
        character
        for character in text
        if character in "\n\t" or ord(character) >= 32
    )
    text = _ASSIGNMENT_SECRET.sub(
        lambda match: f"{match.group('prefix')}{REDACTED}",
        text,
    )
    text = _BEARER_SECRET.sub(rf"\1{REDACTED}", text)
    if len(text) > max_chars:
        text = f"{text[: max(0, max_chars - 1)]}\N{HORIZONTAL ELLIPSIS}"
    return text


def sanitize_error_payload(value: Any) -> Any:
    """Sanitize human-readable fields in a provider error payload."""

    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for key, item in value.items():
            if _is_secret_key(key):
                sanitized[key] = REDACTED
                continue
            lowered = key.lower()
            if lowered in {
                "message",
                "detail",
                "details",
                "additionaldetails",
                "stderr",
                "error",
            } and isinstance(item, (str, bytes)):
                sanitized[key] = sanitize_external_message(item)
            else:
                sanitized[key] = sanitize_error_payload(item)
        return sanitized
    if isinstance(value, list):
        return [sanitize_error_payload(item) for item in value[:100]]
    if isinstance(value, tuple):
        return [sanitize_error_payload(item) for item in value[:100]]
    if isinstance(value, (str, bytes)):
        return sanitize_external_message(value)
    return value
