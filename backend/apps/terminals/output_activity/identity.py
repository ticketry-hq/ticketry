"""Compact deterministic identity for one observed terminal output state."""

from __future__ import annotations

import hashlib


def output_identity(screen: bytes) -> str:
    """Digest the currently rendered screen into a comparable identity.

    Deterministic, so an unchanged reconnect redraw digests to the identity
    already persisted and cannot manufacture activity, and compact, so status
    tracking never becomes a second copy of the terminal's screen or
    scrollback.

    :param screen: the bytes a capture of the durable terminal rendered.
    :return: a 32-character hex identity.
    """

    return hashlib.blake2b(screen, digest_size=16).hexdigest()
