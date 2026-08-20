"""DRF transport contracts for terminal resources and commands."""

from rest_framework import serializers

from apps.runs.run_scopes import RUN_SCOPES
from apps.terminals.models import AgentRunViewerLease, AgentTerminalSession


class RequiredQuerySerializer(serializers.Serializer):
    """Preserve the established structured error for required query identity."""

    required_field: str

    def to_internal_value(self, data):
        value = data.get(self.required_field)
        if not value:
            raise serializers.ValidationError(
                {"detail": {"error": f"{self.required_field}_required"}}
            )
        return super().to_internal_value(data)


class TerminalListQuerySerializer(RequiredQuerySerializer):
    required_field = "task_id"
    task_id = serializers.CharField()


class TerminalIdentityQuerySerializer(RequiredQuerySerializer):
    required_field = "agent_run_id"
    agent_run_id = serializers.CharField()


class ScratchTerminalQuerySerializer(RequiredQuerySerializer):
    required_field = "project_id"
    project_id = serializers.CharField()
    module_id = serializers.CharField(required=False, allow_null=True)


class ResumableTerminalQuerySerializer(serializers.Serializer):
    task_id = serializers.CharField(required=False, allow_null=True)
    project_id = serializers.CharField(required=False, allow_null=True)
    module_id = serializers.CharField(required=False, allow_null=True)


class ModuleShellQuerySerializer(RequiredQuerySerializer):
    required_field = "module_id"
    module_id = serializers.CharField()


class CreateTerminalSerializer(serializers.Serializer):
    agent = serializers.CharField()
    project_id = serializers.CharField()
    module_id = serializers.CharField()
    task_id = serializers.CharField(required=False, allow_null=True, default=None)
    initial_prompt = serializers.CharField(
        required=False, allow_null=True, default=None
    )
    is_planning = serializers.BooleanField(required=False, default=False)
    is_instant = serializers.BooleanField(required=False, default=False)
    instant_prompt = serializers.CharField(
        required=False, allow_null=True, default=None
    )
    is_doc_chat = serializers.BooleanField(required=False, default=False)
    doc_rel_path = serializers.CharField(required=False, allow_null=True, default=None)
    doc_id = serializers.CharField(required=False, allow_null=True, default=None)


class TerminalRunSerializer(serializers.ModelSerializer):
    """Read-only public projection of one durable terminal session."""

    class Meta:
        model = AgentTerminalSession
        fields = ("agent_run_id", "doc_rel_path", "created_at")
        read_only_fields = fields


class AgentRunIdSerializer(serializers.Serializer):
    agent_run_id = serializers.CharField(read_only=True)


class ResumeResultSerializer(AgentRunIdSerializer):
    resumed_from = serializers.CharField(read_only=True)


class TerminateResultSerializer(AgentRunIdSerializer):
    terminated = serializers.BooleanField(read_only=True)


class ResumableTerminalSerializer(serializers.Serializer):
    """Derived resumable-run projection after history de-duplication."""

    agent_run_id = serializers.CharField(read_only=True)
    agent = serializers.CharField(read_only=True)
    status = serializers.CharField(read_only=True)
    started_at = serializers.CharField(read_only=True)
    launch_state = serializers.CharField(read_only=True, allow_null=True)
    launch_model = serializers.CharField(read_only=True, allow_null=True)
    scope = serializers.ChoiceField(choices=RUN_SCOPES, read_only=True)
    provider_session_id = serializers.CharField(read_only=True)
    resumed_from = serializers.CharField(read_only=True, allow_null=True)


class CreateModuleShellSerializer(serializers.Serializer):
    module_id = serializers.CharField()


class ModuleShellSerializer(serializers.ModelSerializer):
    """Read-only public projection of a durable login shell."""

    class Meta:
        model = AgentTerminalSession
        fields = ("agent_run_id", "module_id", "created_at")
        read_only_fields = fields


class ViewerLeaseRequestSerializer(serializers.ModelSerializer):
    """Caller-owned fields for acquiring the viewer lease singleton."""

    agent_run_id = serializers.CharField()
    transport = serializers.ChoiceField(choices=("browser", "desktop"))

    class Meta:
        model = AgentRunViewerLease
        fields = ("agent_run_id", "viewer_id", "transport")


class ViewerLeaseIdentitySerializer(serializers.Serializer):
    agent_run_id = serializers.CharField()
    viewer_id = serializers.CharField()


class ViewerOutputReportSerializer(serializers.Serializer):
    agent_run_id = serializers.CharField()


class ViewerOutputReportResultSerializer(serializers.Serializer):
    agent_run_id = serializers.CharField(read_only=True)
    observed = serializers.BooleanField(read_only=True)


class ReplacedViewerSerializer(serializers.Serializer):
    viewer_id = serializers.CharField(read_only=True)
    transport = serializers.CharField(read_only=True)


class ViewerLeaseResultSerializer(serializers.Serializer):
    agent_run_id = serializers.CharField(read_only=True)
    viewer_id = serializers.CharField(read_only=True)
    transport = serializers.CharField(read_only=True)
    expires_at = serializers.CharField(read_only=True)
    replaced = ReplacedViewerSerializer(read_only=True, allow_null=True)


class ReleaseResultSerializer(serializers.Serializer):
    released = serializers.BooleanField(read_only=True)


class SelfTerminateResultSerializer(serializers.Serializer):
    agent_run_id = serializers.CharField(read_only=True)
    terminated = serializers.BooleanField(read_only=True)
    ok = serializers.BooleanField(read_only=True)
    already_terminated = serializers.BooleanField(read_only=True)
