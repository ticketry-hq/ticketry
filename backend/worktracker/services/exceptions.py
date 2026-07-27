"""Deprecated compatibility aliases for framework-neutral service errors.

New code should import directly from :mod:`worktracker.services.errors`
(``ServiceError``, ``NotFoundError``, ``ValidationError``, ``ConflictError``).
These aliases are kept only so legacy imports keep resolving.
"""

from worktracker.services.errors import (
    ConflictError,
    NotFoundError,
    ServiceError,
    ValidationError,
)


class Conflict(ConflictError):
    pass


class NotFound(NotFoundError):
    pass


class Unprocessable(ValidationError):
    pass
