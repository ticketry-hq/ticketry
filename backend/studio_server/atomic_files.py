"""Atomic file replacement: write a temp sibling, then rename into place.

A rename is the only way to make new content visible all-at-once. The failure
mode this avoids: an ``O_CREAT|O_EXCL`` open followed by a separate write has a
window — a crash, or a second process arriving in it — that leaves the file
existing and truncated, which every later read then has to reject. With a
rename the loser of that race is harmless: it discards its own candidate and
reads the winner's.

Pure stdlib on purpose — no Django import — so ``packaging/sidecar.py`` can use
it before ``django.setup()``.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def atomic_write_bytes(
    path: str | os.PathLike[str],
    data: bytes,
    *,
    mode: int | None = None,
    fsync: bool = False,
) -> None:
    """Replace ``path`` with ``data``, atomically.

    :param path: Destination file. Its parent directory must already exist;
        the temp sibling is created there so the rename stays on one device.
    :param data: Exact bytes to land at ``path``.
    :param mode: chmod applied to the temp file *before* any content is
        written, so the content is never briefly world-readable. ``None``
        leaves mkstemp's 0o600 default.
    :param fsync: flush to disk before the rename. Use for state that must
        survive a hard power loss (secrets, manifests); skip for state a later
        run can rebuild.
    """

    destination = Path(path)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.",
        suffix=".tmp",
        dir=destination.parent,
    )
    temporary_path = Path(temporary_name)
    try:
        if mode is not None:
            os.fchmod(descriptor, mode)
        with os.fdopen(descriptor, "wb") as handle:
            # fdopen took ownership of the descriptor; the handler below must
            # not close it a second time.
            descriptor = -1
            handle.write(data)
            if fsync:
                handle.flush()
                os.fsync(handle.fileno())
        os.replace(temporary_path, destination)
    except BaseException:
        if descriptor >= 0:
            # fdopen itself raised — we still own the descriptor.
            os.close(descriptor)
        temporary_path.unlink(missing_ok=True)
        raise


def atomic_write_json(
    path: str | os.PathLike[str],
    value: Any,
    *,
    indent: int | None = None,
    sort_keys: bool = False,
    separators: tuple[str, str] | None = None,
    trailing_newline: bool = False,
    mode: int | None = None,
    fsync: bool = False,
) -> None:
    """:func:`atomic_write_bytes` with a ``json.dumps`` in front.

    Serialization happens before the temp file is created, so an
    unserializable value raises without leaving a ``.tmp`` sibling behind.
    """

    payload = json.dumps(value, indent=indent, sort_keys=sort_keys, separators=separators)
    if trailing_newline:
        payload += "\n"
    atomic_write_bytes(path, payload.encode("utf-8"), mode=mode, fsync=fsync)
