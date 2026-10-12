#!/usr/bin/env python3
"""Validate a directly authored canonical LLD.html file."""

from __future__ import annotations

import argparse
import html as html_entities
import re
from pathlib import Path

REUSE_CATEGORIES = (
    ("reused", "Reused", True),
    ("generated", "Generated or configured", True),
    ("new", "New", False),
)
REUSE_SAMPLE_TEXT = ("replace this reuse row", "src/example/")
NONE_ANSWER = re.compile(r"\W*none\b(?!-\w)", re.IGNORECASE)
NONE_WITH_REASON = re.compile(r"\W*none[^\w—–:-]*[—–:-]+\W*\w", re.IGNORECASE)
REPOSITORY_CITATION = re.compile(
    r"<code>\s*(?!/|~|[a-z][a-z0-9+.-]*:)[\w.@-]+(?:/[\w.@-]+)+(?:[#:][^<\s]*)?\s*</code>",
    re.IGNORECASE,
)


def rendered_cells(row: str) -> list[str]:
    """Return the visible text of each data cell, ignoring markup and entity spelling."""
    cells = re.findall(r"<td\b[^>]*>(.*?)</td>", row, re.IGNORECASE | re.DOTALL)
    return [" ".join(html_entities.unescape(re.sub(r"<[^>]+>", " ", cell)).split()) for cell in cells]


def has_words(text: str) -> bool:
    return re.search(r"\w", text) is not None


def reuse_record_errors(html: str) -> list[str]:
    section = re.search(
        r'<section\b[^>]*\bid=["\']reuse-record["\'][^>]*>(.*?)</section>', html, re.IGNORECASE | re.DOTALL
    )
    if section is None:
        return ['missing reuse record section: id="reuse-record"']
    body = section.group(1)
    errors = [
        f"reuse record still contains template sample text: {sample}"
        for sample in REUSE_SAMPLE_TEXT
        if sample in body.lower()
    ]
    rows = re.findall(
        r'<tr\b[^>]*\bdata-reuse=["\'](\w+)["\'][^>]*>(.*?)</tr>', body, re.IGNORECASE | re.DOTALL
    )
    for key, label, needs_citation in REUSE_CATEGORIES:
        category_rows = [row for row_key, row in rows if row_key.lower() == key]
        if not category_rows:
            errors.append(f'reuse record category {label} ({key}) needs a row or an explicit "none — <reason>"')
            continue
        for row in category_rows:
            cells = rendered_cells(row)
            answer = " ".join(cells)
            if NONE_ANSWER.match(answer):
                if not NONE_WITH_REASON.match(answer):
                    errors.append(f'reuse record category {label} ({key}) says none without a reason; write "none — <reason>"')
            elif len(cells) < 2 or not has_words(cells[0]) or not has_words(cells[-1]):
                errors.append(f"reuse record {label} ({key}) row needs a behaviour and a justification")
            elif needs_citation and not REPOSITORY_CITATION.search(row):
                errors.append(
                    f"reuse record {label} ({key}) row needs a repository-relative citation in <code>, e.g. <code>docs/feature-map/settings.md</code>"
                )
    return errors


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
    errors.extend(reuse_record_errors(html))
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
