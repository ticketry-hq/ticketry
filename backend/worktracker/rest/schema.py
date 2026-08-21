"""OpenAPI schema behavior for WorkTracker's body-bearing DELETE operations."""

from drf_spectacular.openapi import AutoSchema


class DeleteRequestBodyAutoSchema(AutoSchema):
    """Let explicitly annotated DELETE handlers describe their JSON body.

    drf-spectacular intentionally limits request bodies to POST, PUT, and PATCH.
    OpenAPI 3 permits a DELETE request body, and WorkTracker uses one for
    explicit reassignment and workflow revision guards.
    """

    def _get_request_body(self, direction="request"):
        if self.method != "DELETE":
            return super()._get_request_body(direction)

        method = self.method
        self.method = "POST"
        try:
            return super()._get_request_body(direction)
        finally:
            self.method = method


class RequiredPatchAndDeleteRequestBodyAutoSchema(DeleteRequestBodyAutoSchema):
    """Describe a PATCH whose transport contract requires its declared fields."""

    def _get_request_body(self, direction="request"):
        if self.method != "PATCH":
            return super()._get_request_body(direction)

        method = self.method
        self.method = "PUT"
        try:
            return super()._get_request_body(direction)
        finally:
            self.method = method
