"""DRF authentication for the owned WorkTracker HTTP surface."""

import hmac
from dataclasses import dataclass

from django.conf import settings
from drf_spectacular.extensions import OpenApiAuthenticationExtension
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed


@dataclass(frozen=True)
class _ApiKeyPrincipal:
    """Minimal authenticated principal for the desktop's static API key."""

    is_authenticated: bool = True


_PRINCIPAL = _ApiKeyPrincipal()


class ApiKeyAuthentication(BaseAuthentication):
    """Authenticate the default DRF surface through ``x-api-key``."""

    header = "x-api-key"

    def authenticate(self, request):
        if getattr(settings, "WORKTRACKER_DISABLE_AUTH", False):
            return _PRINCIPAL, None

        supplied = request.headers.get(self.header)
        expected = getattr(settings, "WORKTRACKER_API_TOKEN", "")
        if expected and supplied is not None and hmac.compare_digest(supplied, expected):
            return _PRINCIPAL, supplied

        raise AuthenticationFailed("Invalid or missing API key.")

    def authenticate_header(self, request):
        return self.header


class ApiKeyAuthenticationScheme(OpenApiAuthenticationExtension):
    """Describe the custom header in drf-spectacular's generated contract."""

    target_class = "worktracker.rest.authentication.ApiKeyAuthentication"
    name = "ApiKeyAuth"

    def get_security_definition(self, auto_schema):
        return {"type": "apiKey", "in": "header", "name": "x-api-key"}
