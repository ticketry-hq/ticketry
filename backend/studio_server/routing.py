from django.urls import path

from apps.runs.chat.consumer import ChatStreamConsumer
from apps.runs.consumers import StatusStreamConsumer
from apps.terminals.consumers import TerminalConsumer


websocket_urlpatterns = [
    path("ws/status", StatusStreamConsumer.as_asgi()),
    path("ws/terminal", TerminalConsumer.as_asgi()),
    path("ws/chat", ChatStreamConsumer.as_asgi()),
]
