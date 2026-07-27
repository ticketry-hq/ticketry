from contextlib import contextmanager

from ninja import Router
from ninja.errors import HttpError

from worktracker.auth import ApiKeyAuth
from worktracker.services.errors import ServiceError


# Router-level auth (C7) - all routes inherit the static-token check.
router = Router(tags=["worktracker"], auth=ApiKeyAuth())


@contextmanager
def _http_errors():
    """Surface domain :class:`ServiceError`s on the HTTP contract (status + message).

    The single route-layer seam that converts framework-neutral service errors
    into Ninja ``HttpError``; ``HttpError`` must not appear anywhere else.
    """

    try:
        yield
    except ServiceError as exc:
        raise HttpError(exc.status_code, exc.message) from exc
