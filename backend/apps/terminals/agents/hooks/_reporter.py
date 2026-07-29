"""Shared lifecycle-hook reporter for every coding-agent adapter (#499–#502).

The four per-agent hook scripts in this package (``claude_hook.py``,
``codex_hook.py``, ``gemini_hook.py``, ``agy_hook.py``) all perform the same
stdin -> map -> stamp -> POST dance; only their event tables, identity source,
and provider-session key differ. That variation is captured in a small
``HookSpec`` each shim declares, and the shared machinery lives here.

Design constraints (acceptance criteria carried over from every adapter):

- **Stdlib only.** A hook runs as a subprocess of the agent CLI, whose
  environment may not expose the backend's ``apps``/``core`` packages; depending
  on nothing but the standard library keeps it robust regardless of interpreter
  or ``PYTHONPATH``. Nothing under ``hooks/`` may import ``apps.*``.
- **Never disrupts the agent.** Every failure path — bad input, missing
  identity, unreachable server — is swallowed and the process exits 0.
- **stdout stays clean.** Gemini and agy parse hook stdout as JSON; a stray
  print would be read as a hook decision, so the reporter never writes stdout.
- **Self-disabling.** Without a run identity the session is treated as
  un-tracked and nothing is sent.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Mapping, Optional, Sequence
from urllib import request as urllib_request

# Environment keys carrying this run's identity, set by the launch helper for
# env-mode agents (Claude).

ENV_AGENT_RUN_ID = "MUXED_AGENT_RUN_ID"
ENV_LIFECYCLE_URL = "MUXED_LIFECYCLE_URL"

# Loopback ingress used when the launcher does not override the URL.
#
# This is the one place either the port or the path is written down (#1462).
# ``apps.terminals.agents.injectors`` imports ``DEFAULT_LIFECYCLE_URL`` from here
# instead of restating it, so a hook's own fallback and the launcher's default
# cannot drift apart and start posting to different ports. The constant lives at
# this leaf rather than beside the launcher because this module is stdlib-only by
# contract: it may be imported upward, never the reverse.

DEFAULT_BACKEND_PORT = 8787
LIFECYCLE_PATH = "/api/lifecycle/events"


def lifecycle_url_for_port(port: int | str) -> str:
    """Return the loopback ingress URL for a backend listening on ``port``.

    Lets a caller that knows the real port build the URL without restating the
    path, so a backend started somewhere other than
    :data:`DEFAULT_BACKEND_PORT` is still addressed correctly.
    """

    return f"http://127.0.0.1:{port}{LIFECYCLE_PATH}"


DEFAULT_LIFECYCLE_URL = lifecycle_url_for_port(DEFAULT_BACKEND_PORT)

# Quick timeout so a missing/slow listener never stalls an agent turn.

POST_TIMEOUT_SECONDS = 2.0


@dataclass(frozen=True)
class HookSpec:
    """The per-agent variation the shared reporter needs.

    :param slug: The ``agent`` value stamped on the wire payload.
    :param event_to_kind: Mapping of agent hook event name -> #498
        ``LifecycleEventKind``. An absent key means "unrecognized" (ignored).
    :param identity: ``"env"`` (run id/url from the environment) or ``"argv"``
        (baked into the hook command line by the launcher).
    :param provider_session_keys: Hook-payload keys probed in order for the
        provider's native resumable session id.
    """

    slug: str
    event_to_kind: Mapping[str, str]
    identity: str
    provider_session_keys: tuple


def event_to_kind(spec: HookSpec, event_name: Optional[str]) -> Optional[str]:
    """Map an agent hook event name to a normalized lifecycle kind.

    :param spec: The agent's hook spec.
    :param event_name: The ``hook_event_name`` from the agent's stdin payload.
    :return: The matching #498 ``LifecycleEventKind``, or ``None`` when the
        event is unmapped (or ``None``).
    """

    if event_name is None:
        return None
    return spec.event_to_kind.get(event_name)


def extract_provider_session_id(
    spec: HookSpec,
    hook_input: Mapping,
) -> Optional[str]:
    """Return the provider's native resumable session id when explicitly present.

    Probes ``spec.provider_session_keys`` in order and returns the first value
    that is a non-empty ``str``. Non-string garbage is dropped for every agent
    (ADR-0002): real payloads carry string UUIDs, so this tightening only
    rejects malformed values.

    :param spec: The agent's hook spec.
    :param hook_input: Parsed JSON the agent wrote to the hook's stdin.
    :return: The explicit provider session id, or ``None`` when not exposed.
    """

    for key in spec.provider_session_keys:
        value = hook_input.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def build_payload(
    spec: HookSpec,
    kind: str,
    agent_run_id: str,
    ts: str,
    message: Optional[str] = None,
    provider_session_id: Optional[str] = None,
) -> dict:
    """Build the ``LifecycleEvent`` wire payload for the ingress.

    The key insertion order (``agent_run_id``, ``agent``, ``kind``, ``ts``,
    ``source``, then optional ``message`` and ``provider_session_id``) is an
    acceptance criterion — it keeps ``json.dumps`` byte-compatible with the
    per-agent hooks this reporter replaces.

    :param spec: The agent's hook spec (supplies the ``agent`` slug).
    :param kind: Normalized lifecycle kind for this event.
    :param agent_run_id: Durable id of the run this event belongs to.
    :param ts: ISO-8601 timestamp from the emitter's clock.
    :param message: Optional human-readable note (only attached when truthy).
    :param provider_session_id: Provider's native resumable id (only attached
        when truthy).
    :return: A dict matching the #498 ``LifecycleEvent`` schema.
    """

    payload = {
        "agent_run_id": agent_run_id,
        "agent": spec.slug,
        "kind": kind,
        "ts": ts,
        "source": "hook",
    }

    # Only attach a note when one is present, to keep payloads minimal.

    if message:
        payload["message"] = message

    # Carry the resumable session id only when the agent supplied one.

    if provider_session_id:
        payload["provider_session_id"] = provider_session_id
    return payload


def build_event_from_hook(
    spec: HookSpec,
    hook_input: Mapping,
    agent_run_id: Optional[str],
    now_iso: str,
) -> Optional[dict]:
    """Turn a hook stdin payload plus run identity into an event, or skip it.

    Pure and side-effect free so the mapping and identity handling are
    unit-testable without any I/O.

    :param spec: The agent's hook spec.
    :param hook_input: Parsed JSON the agent wrote to the hook's stdin.
    :param agent_run_id: Durable run id for this session (env- or argv-sourced).
    :param now_iso: Pre-computed ISO-8601 timestamp to stamp on the event.
    :return: The event payload to send, or ``None`` when the event is
        unrecognized or the session is un-tracked.
    """

    # Ignore events this adapter does not map onto the lifecycle axis.

    kind = event_to_kind(spec, hook_input.get("hook_event_name"))
    if kind is None:
        return None

    # Without a run id the session is not tracked; stay silent.

    if not agent_run_id:
        return None

    # All agents carry the human note under the literal ``message`` key.

    return build_payload(
        spec,
        kind,
        agent_run_id,
        now_iso,
        hook_input.get("message"),
        extract_provider_session_id(spec, hook_input),
    )


def post_event(
    url: str,
    payload: dict,
    timeout: float = POST_TIMEOUT_SECONDS,
) -> None:
    """POST one event to the ingress, swallowing every error.

    A missing, slow, or erroring listener must never surface to the agent, so
    all exceptions are intentionally suppressed.

    :param url: Lifecycle ingress URL to POST to.
    :param payload: The event payload to serialize and send.
    :param timeout: Per-request timeout in seconds.
    """

    data = json.dumps(payload).encode("utf-8")
    req = urllib_request.Request(
        url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib_request.urlopen(req, timeout=timeout):
            pass
    except Exception:
        # Reporting is best-effort; failure here is never fatal.
        pass


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    """Parse the run-identity arguments the launcher bakes into the command.

    :param argv: Argument list to parse; defaults to the process arguments.
    :return: A namespace with ``agent_run_id`` and ``lifecycle_url``.
    """

    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--agent-run-id", default=None)
    parser.add_argument("--lifecycle-url", default=DEFAULT_LIFECYCLE_URL)

    # Ignore any stray args so an unexpected token never aborts the hook.

    args, _ = parser.parse_known_args(argv)
    return args


def run(spec: HookSpec) -> None:
    """Read one hook event from stdin and best-effort report it.

    Wraps the whole flow so any unexpected error still ends in a clean exit,
    guaranteeing the hook can never interrupt the agent session. Never prints
    to stdout — the agent may parse it as a hook decision.

    :param spec: The agent's hook spec, declared by the calling shim.
    """

    try:
        raw = sys.stdin.read()
        hook_input = json.loads(raw) if raw.strip() else {}
        now_iso = datetime.now(timezone.utc).isoformat()

        # Resolve run identity + ingress url from the agent's chosen channel.

        if spec.identity == "env":
            agent_run_id = os.environ.get(ENV_AGENT_RUN_ID)
            url = os.environ.get(ENV_LIFECYCLE_URL) or DEFAULT_LIFECYCLE_URL
        else:
            args = parse_args()
            agent_run_id = args.agent_run_id
            url = args.lifecycle_url

        payload = build_event_from_hook(spec, hook_input, agent_run_id, now_iso)

        # Send only when we have a recognized, tracked event.

        if payload is not None:
            post_event(url, payload)
    except Exception:
        # Swallow anything; a hook error must not break the session.
        pass

    # Always succeed regardless of what happened above.

    sys.exit(0)
