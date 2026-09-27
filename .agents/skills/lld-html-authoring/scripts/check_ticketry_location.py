#!/usr/bin/env python3
"""Check that LLD artifacts live in a canonical Ticketry design directory."""

from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Optional, Tuple


MODULE_DIRECTORY = re.compile(r"^.+--[0-9a-fA-F]{8}$")
TASK_DIRECTORY = re.compile(r"^(?:T[0-9]+|[0-9a-fA-F]{8})--.+$")
RUN_DIRECTORY = re.compile(r"^[0-9a-fA-F]{8}$")


def design_shape(path: Path) -> Tuple[Optional[str], Optional[Path]]:
    resolved = path.resolve()
    parts = resolved.parts
    spec_indexes = [index for index, part in enumerate(parts) if part == "spec"]
    if not spec_indexes:
        return None, None
    spec_index = spec_indexes[-1]
    relative = parts[spec_index + 1 :]
    if len(relative) == 3 and MODULE_DIRECTORY.fullmatch(relative[0]) and TASK_DIRECTORY.fullmatch(relative[1]):
        return "task", Path(*parts[: spec_index + 3])
    if len(relative) == 4 and MODULE_DIRECTORY.fullmatch(relative[0]) and relative[1] == "planning" and RUN_DIRECTORY.fullmatch(relative[2]):
        return "planning", Path(*parts[: spec_index + 4])
    return None, None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifacts", nargs="+", type=Path)
    args = parser.parse_args()
    errors: list[str] = []
    roots: set[Path] = set()
    scopes: set[str] = set()
    for artifact in args.artifacts:
        if not artifact.is_file():
            errors.append(f"artifact does not exist: {artifact}")
            continue
        scope, root = design_shape(artifact)
        if scope is None or root is None:
            errors.append(f"outside canonical Ticketry task or planning directory: {artifact.resolve()}")
            continue
        if artifact.resolve().parent != root:
            errors.append(f"LLD artifact must be at the design-directory root: {artifact.resolve()}")
        roots.add(root)
        scopes.add(scope)
    if len(roots) > 1:
        errors.append("LLD artifacts are split across design directories")
    if errors:
        for error in errors:
            print(f"error: {error}")
        return 1
    root = next(iter(roots))
    scope = next(iter(scopes))
    print(f"Ticketry {scope} location valid: {root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
