#!/usr/bin/env python3
"""Validate a directly authored canonical LLD.html file."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("html", type=Path)
    args = parser.parse_args()
    if not args.html.is_file():
        parser.error("HTML file must exist")

    html = args.html.read_text(encoding="utf-8")
    normalized = re.sub(r"\s+", " ", html).lower()
    errors: list[str] = []
    checks = (
        (r'<meta\s+[^>]*name=["\']color-scheme["\'][^>]*content=["\']dark["\']', "missing dark color-scheme metadata"),
        (r'color-scheme\s*:\s*dark\s*;', "missing inline dark color-scheme"),
        (r'<meta\s+[^>]*name=["\']lld-authority["\'][^>]*content=["\']html["\']', "missing lld-authority=html meta tag"),
        (r'id=["\']file-changes["\']', 'missing file-change view: id="file-changes"'),
        (r'id=["\']file-rail["\']', 'missing file-change navigation: id="file-rail"'),
        (r'id=["\']file-inspector["\']', 'missing file detail panel: id="file-inspector"'),
        (r'const\s+lld_document\s*=', "missing LLD_DOCUMENT presentation data"),
    )
    for pattern, message in checks:
        if not re.search(pattern, html, re.IGNORECASE):
            errors.append(message)
    if re.search(r'<body\b[^>]*data-template=["\']true["\']', html, re.IGNORECASE):
        errors.append('template sample is still active; set body data-template="false"')
    if "this html document is authoritative" not in normalized:
        errors.append("missing visible HTML authority statement")
    section_positions = {
        section: html.lower().find(f'id="{section}"')
        for section in ("file-changes", "context", "execution", "acceptance")
    }
    supporting_positions = [
        position
        for section, position in section_positions.items()
        if section != "file-changes" and position >= 0
    ]
    if section_positions["file-changes"] < 0 or any(
        section_positions["file-changes"] > position for position in supporting_positions
    ):
        errors.append("file-change workspace must precede supporting sections")
    if "lld.md is authoritative" in normalized or 'name="lld-source"' in normalized:
        errors.append("Markdown mirror metadata or authority language remains")
    for sample in ("replace this example", "src/example/", "t000"):
        if sample in normalized:
            errors.append(f"sample content remains: {sample}")

    if errors:
        for error in errors:
            print(f"error: {error}")
        return 1
    print(f"HTML LLD valid: {args.html}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
