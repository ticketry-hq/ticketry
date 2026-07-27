"""Framework-neutral service errors."""


class ServiceError(Exception):
    """Domain error with an API-mappable status code and message."""

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message

    @property
    def status(self):
        return self.status_code


class NotFoundError(ServiceError):
    """Requested domain object was not found."""

    def __init__(self, message: str):
        super().__init__(404, message)


class ValidationError(ServiceError):
    """Requested domain change is invalid."""

    def __init__(self, message: str):
        super().__init__(422, message)


class ConflictError(ServiceError):
    """Requested domain change conflicts with current state."""

    def __init__(self, message: str):
        super().__init__(409, message)
