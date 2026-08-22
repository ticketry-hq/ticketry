"""Django exposes no production WebSocket routes.

Terminal bytes and controls are owned by the Rust tmux adapter. Status uses the
in-process GraphQL subscription, so an empty route table is intentional.
"""

websocket_urlpatterns = []
