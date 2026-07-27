from django.conf import settings
from ninja.security import APIKeyHeader


class ApiKeyAuth(APIKeyHeader):
    """Static API-token auth applied to every worktracker route (C7).

    Reads the ``x-api-key`` header and compares it against the configured
    ``WORKTRACKER_API_TOKEN``. Set ``WORKTRACKER_DISABLE_AUTH`` to bypass this
    check for local development.
    """

    param_name = "x-api-key"

    def authenticate(self, request, key):
        """Return the key when it matches the configured token, else None.

        :param request: the inbound HTTP request (unused).
        :param key: the value of the ``x-api-key`` header, if present.
        :return: the key as a truthy principal, or ``None`` to reject.
        """

        if getattr(settings, "WORKTRACKER_DISABLE_AUTH", False):
            return request

        expected = getattr(settings, "WORKTRACKER_API_TOKEN", "")

        if expected and key == expected:
            return key

        return None
