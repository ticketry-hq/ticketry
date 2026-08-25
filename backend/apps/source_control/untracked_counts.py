"""Insertion counts and binary detection for untracked files.

``git diff HEAD --numstat`` cannot see a file git does not track yet, and the
review surface still has to show "+N" for it. Counting here — rather than
spawning one ``git diff --no-index`` per new file, or staging the tree into a
scratch index — keeps the read free of subprocesses and free of any write to
the object store.

The two rules mirror git's own: a file is binary when a NUL byte appears in
its first 8000 bytes (git's ``FIRST_FEW_BYTES`` sniff), and its line count is
its newline count plus one for a final line with no terminator.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

#: Git's own binary sniff window.
_SNIFF_BYTES = 8000

_CHUNK_BYTES = 64 * 1024


@dataclass(frozen=True)
class UntrackedCount:
    lines: int
    binary: bool


def count_untracked_file(absolute_path: str) -> UntrackedCount | None:
    """Lines and binariness for one untracked file, or ``None`` if unreadable.

    Symlinks and special files are reported as zero-line non-binary entries
    rather than followed, so a dangling link in a worktree cannot fail a read.
    """

    try:
        if os.path.islink(absolute_path) or not os.path.isfile(absolute_path):
            return UntrackedCount(lines=0, binary=False)
        with open(absolute_path, "rb") as handle:
            newlines = 0
            total = 0
            binary = False
            last_byte = b""
            while True:
                chunk = handle.read(_CHUNK_BYTES)
                if not chunk:
                    break
                if not binary and total < _SNIFF_BYTES:
                    if b"\0" in chunk[: _SNIFF_BYTES - total]:
                        binary = True
                newlines += chunk.count(b"\n")
                total += len(chunk)
                last_byte = chunk[-1:]
    except OSError:
        return None

    if binary:
        return UntrackedCount(lines=0, binary=True)
    if total == 0:
        return UntrackedCount(lines=0, binary=False)
    unterminated = 1 if last_byte != b"\n" else 0
    return UntrackedCount(lines=newlines + unterminated, binary=False)
