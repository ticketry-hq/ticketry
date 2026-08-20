"""Authentication context for the Run Now execution action."""

from dataclasses import dataclass

from apps.terminals.authorization import (
    RunAuthorizationError,
    verify_run_authorization,
)
from worktracker.rest.authentication import ApiKeyAuthentication


@dataclass(frozen=True)
class RunNowAuthenticationContext:
    """Optional trusted run identity layered onto required API-key auth."""

    caller_agent_run_id: str | None


class RunNowAuthentication(ApiKeyAuthentication):
    """Require the desktop API key and recognize an optional signed caller."""

    def authenticate(self, request):
        principal, _api_key = super().authenticate(request)
        try:
            caller_agent_run_id = verify_run_authorization(
                request.headers.get("Authorization")
            )
        except RunAuthorizationError:
            caller_agent_run_id = None
        return principal, RunNowAuthenticationContext(caller_agent_run_id)
