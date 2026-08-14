import uuid

from django.db import models


class Provider(models.Model):
    """A persisted provider description paired with one code-owned adapter."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.CharField(max_length=64, unique=True)
    activated = models.BooleanField(default=False)
    supports_unattended = models.BooleanField(default=False)

    class Meta:
        ordering = ("slug",)

    def __str__(self):
        return self.slug


class ReasoningLevel(models.Model):
    """A named reasoning effort that models may explicitly permit."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=32, unique=True)

    class Meta:
        ordering = ("name",)

    def __str__(self):
        return self.name


class AgentModel(models.Model):
    """A user-extensible model identifier offered by one provider."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    provider = models.ForeignKey(
        Provider,
        on_delete=models.PROTECT,
        related_name="models",
    )
    name = models.CharField(max_length=255)
    permitted_reasoning_levels = models.ManyToManyField(
        ReasoningLevel,
        through="AgentModelReasoningLevel",
        related_name="agent_models",
        blank=True,
    )

    class Meta:
        ordering = ("provider__slug", "name")
        constraints = [
            models.UniqueConstraint(
                fields=("provider", "name"),
                name="unique_agent_model_provider_name",
            )
        ]

    def __str__(self):
        return f"{self.provider.slug}:{self.name}"


class AgentModelReasoningLevel(models.Model):
    """Owned catalog link removed with either side of the relationship."""

    agent_model = models.ForeignKey(AgentModel, on_delete=models.CASCADE)
    reasoning_level = models.ForeignKey(ReasoningLevel, on_delete=models.CASCADE)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("agent_model", "reasoning_level"),
                name="unique_agent_model_reasoning_level",
            )
        ]
