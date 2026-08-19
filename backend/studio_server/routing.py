from django.urls import path

from apps.terminals.consumers import TerminalConsumer


# The project status WebSocket was retired at the Slice 3 handoff. Studio's
# sole status authority is the in-process GraphQL subscription over the durable
# Rust outbox, so there is deliberately no second status transport to fall back
# to. Only the terminal transport remains, and it moves with the Terminals
# slice.
websocket_urlpatterns = [
    path("ws/terminal", TerminalConsumer.as_asgi()),
]
