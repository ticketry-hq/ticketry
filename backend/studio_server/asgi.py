import inspect
import os

from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application


os.environ.setdefault("DJANGO_SETTINGS_MODULE", "studio_server.settings")

startup_callables = []
shutdown_callables = []


def register_startup(fn):
    """Register a callable for ASGI startup."""
    startup_callables.append(fn)


def register_shutdown(fn):
    """Register a callable for ASGI shutdown."""
    shutdown_callables.append(fn)


async def _run(callables):
    """Run registered synchronous or asynchronous callables."""
    for fn in callables:
        result = fn()
        if inspect.isawaitable(result):
            await result


django_asgi_app = get_asgi_application()

from studio_server.routing import websocket_urlpatterns

# Terminal launch, provider-hook drains, transition-driven launch execution,
# reconciliation, periodic sweeps, and shutdown cleanup all run in Rust.
# Django remains supervised for unrelated capabilities and registers no
# compatibility terminal task.

router = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": URLRouter(websocket_urlpatterns),
    },
)


async def application(scope, receive, send):
    """Route ASGI traffic and handle optional lifespan events."""
    if scope["type"] != "lifespan":
        await router(scope, receive, send)
        return

    while True:
        message = await receive()
        if message["type"] == "lifespan.startup":
            await _run(startup_callables)
            await send({"type": "lifespan.startup.complete"})
        elif message["type"] == "lifespan.shutdown":
            await _run(shutdown_callables)
            await send({"type": "lifespan.shutdown.complete"})
            return
