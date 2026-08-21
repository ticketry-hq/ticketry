"""DRF authentication backed by Studio-issued run credentials."""

from dataclasses import dataclass

from django.conf import settings
from rest_framework.authentication import BaseAuthentication

from apps.errors import ApplicationError
from apps.terminals.authorization import (
    RunAuthorizationError,
    verify_run_authorization,
)


@dataclass(frozen=True)
class RunScopedPrincipal:
    """Authenticated identity bound to one durable agent run."""

    agent_run_id: str | None
    is_authenticated: bool = True


class RunScopedAuthentication(BaseAuthentication):
    """Authenticate a Studio-signed Bearer credential bound to one run."""

    bypass_when_auth_disabled = False

    def authenticate(self, request):
        if self.bypass_when_auth_disabled and getattr(
            settings, "WORKTRACKER_DISABLE_AUTH", False
        ):
            return RunScopedPrincipal(agent_run_id=None), None

        authorization = request.headers.get("Authorization")
        try:
            agent_run_id = verify_run_authorization(authorization)
        except RunAuthorizationError as exc:
            raise ApplicationError(401, str(exc), code="caller_run_unbound") from exc
        return RunScopedPrincipal(agent_run_id=agent_run_id), authorization

    def authenticate_header(self, request):
        return "Bearer"


class LifecycleRunScopedAuthentication(RunScopedAuthentication):
    """Preserve the explicit development bypass for lifecycle hook ingress."""

    bypass_when_auth_disabled = True
