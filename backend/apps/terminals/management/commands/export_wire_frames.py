"""Export the terminal WebSocket wire-frame JSON Schema (#692 · T687-3).

Sibling of the worktracker ``export_openapi`` command, but for the ``/ws/terminal``
frames instead of the REST surface. Dumps the schema declared in
:mod:`terminals.frames` to the committed artifact that the Studio contract test
and the drift gate both read.
"""

import json
from pathlib import Path

from django.core.management.base import BaseCommand

from apps.terminals.frames import wire_frames_schema

# Default committed location: studio/src/shared/api/transport/.
_DEFAULT_DESTINATION = (
    Path(__file__).resolve().parents[5]
    / "studio"
    / "src"
    / "shared"
    / "api"
    / "transport"
    / "wire-frames.schema.json"
)


class Command(BaseCommand):
    help = "Export the terminal WebSocket wire-frame JSON Schema."

    def add_arguments(self, parser):
        parser.add_argument(
            "destination",
            nargs="?",
            type=Path,
            default=_DEFAULT_DESTINATION,
        )

    def handle(self, *args, **options):
        destination = options["destination"].resolve()
        content = (
            json.dumps(
                wire_frames_schema(),
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
