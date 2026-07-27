import uuid

from django.db import models

from .issue import Issue


class ForceTransition(models.Model):
    """A minimal durable trace of a *forced* workflow move (CODIN-860).

    Written only by ``worktracker.workflow.transition_state`` when
    ``force=True`` — the audit that the transition gate was bypassed, by whom
    (``actor``, nullable — the static-token API has no user identity), and the
    move made. Deliberately not a general audit subsystem: it records the
    override, nothing else.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    issue = models.ForeignKey(
        Issue, on_delete=models.CASCADE, related_name="force_transitions"
    )
    from_state = models.CharField(max_length=64, null=True, blank=True)
    to_state = models.CharField(max_length=64, null=True, blank=True)
    actor = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"force {self.from_state} → {self.to_state} ({self.issue_id})"
