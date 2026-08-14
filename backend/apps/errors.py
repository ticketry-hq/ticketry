"""Framework-neutral failures shared by Ticketry application operations."""

from worktracker.services.errors import ServiceError


class ApplicationError(ServiceError):
    """A declared operation failure with its stable public error payload."""

    def __init__(
        self,
        status_code: int,
        detail: str,
        *,
        code: str | None = None,
        metadata: dict | None = None,
        body: dict | None = None,
    ):
        super().__init__(status_code, detail)
        self.code = code
        self.metadata = metadata or {}
        self.body = body

    def as_body(self):
        if self.body is not None:
            return self.body
        payload = {"detail": self.message}
        if self.code is not None:
            payload["code"] = self.code
        payload.update(self.metadata)
        return payload
