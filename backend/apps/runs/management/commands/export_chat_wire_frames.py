"""Export the checked bidirectional ``/ws/chat`` JSON Schema."""

import json
from pathlib import Path

from django.core.management.base import BaseCommand

from apps.runs.chat.contracts import chat_wire_frames_schema


_DEFAULT_DESTINATION = (
    Path(__file__).resolve().parents[5]
    / "studio"
    / "src"
    / "features"
    / "agents"
    / "chat"
    / "chat-wire-frames.schema.json"
)


class Command(BaseCommand):
    help = "Export the Chat WebSocket wire-frame JSON Schema."

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
                chat_wire_frames_schema(),
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
