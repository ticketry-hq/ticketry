"""Export the canonical WorkTracker OpenAPI document without running a server."""

import json
from pathlib import Path

from django.core.management.base import BaseCommand

from worktracker.openapi import build_openapi_schema


class Command(BaseCommand):
    help = "Export deterministic WorkTracker OpenAPI JSON."

    def add_arguments(self, parser):
        parser.add_argument(
            "destination",
            nargs="?",
            type=Path,
            default=Path(__file__).resolve().parents[4] / "openapi.json",
        )

    def handle(self, *args, **options):
        destination = options["destination"].resolve()
        content = (
            json.dumps(
                build_openapi_schema(),
                indent=2,
                sort_keys=True,
                ensure_ascii=False,
            )
            + "\n"
        )
        destination.parent.mkdir(parents=True, exist_ok=True)
        previous = destination.read_text(encoding="utf-8") if destination.exists() else None
        if previous != content:
            destination.write_text(content, encoding="utf-8")
            self.stdout.write(f"wrote {destination}")
        else:
            self.stdout.write(f"unchanged {destination}")
