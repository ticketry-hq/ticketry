"""Checked WebSocket contract for durable structured Chat runs."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    field_validator,
)


class ChatContractModel(BaseModel):
    """Reject unknown wire fields so contract drift fails at the boundary."""

    model_config = ConfigDict(extra="forbid")


class ChatRunSnapshot(ChatContractModel):
    """Stable run identity and outcome fields needed by the Chat surface."""

    agent_run_id: str
    project_id: str
    module_id: str
    task_id: str | None
    agent: str
    run_kind: Literal["chat"] = "chat"
    scope: Literal["task", "plan", "instant"]
    status: str
    state: str | None = None
    started_at: str
    ended_at: str | None = None
    cwd: str | None = None


class ChatSessionSnapshot(ChatContractModel):
    """Current provider-thread state paired with the durable transcript."""

    provider_thread_id: str | None = None
    status: Literal[
        "starting",
        "ready",
        "running",
        "interrupted",
        "stopped",
        "error",
    ]
    active_turn_id: str | None = None
    last_error: str | None = None
    next_sequence: int = Field(ge=1)
    last_sequence: int = Field(ge=0)
    created_at: str
    updated_at: str


class ChatEventRecord(ChatContractModel):
    """One normalized durable event and its run-local reconnect cursor."""

    sequence: int = Field(ge=1)
    event_type: str = Field(min_length=1)
    payload: dict[str, Any]
    created_at: str


class ChatSnapshotFrame(ChatContractModel):
    """Authoritative session state plus an ordered transcript tail."""

    v: Literal[1] = 1
    type: Literal["snapshot"] = "snapshot"
    agent_run_id: str
    run: ChatRunSnapshot
    session: ChatSessionSnapshot
    events: list[ChatEventRecord]
    cursor: int = Field(ge=0)


class ChatReadyFrame(ChatContractModel):
    """Marks the point after which frames are live deltas."""

    v: Literal[1] = 1
    type: Literal["ready"] = "ready"
    agent_run_id: str
    cursor: int = Field(ge=0)


class ChatEventFrame(ChatContractModel):
    """One ordered live transcript delta."""

    v: Literal[1] = 1
    type: Literal["event"] = "event"
    agent_run_id: str
    event: ChatEventRecord


class ChatCommandAckFrame(ChatContractModel):
    """Correlates successful command submission with the initiating client."""

    v: Literal[1] = 1
    type: Literal["ack"] = "ack"
    agent_run_id: str
    command_id: str
    command: Literal[
        "start_turn",
        "interrupt",
        "respond_approval",
        "respond_user_input",
        "stop",
    ]
    result: dict[str, Any] = Field(default_factory=dict)


class ChatErrorFrame(ChatContractModel):
    """Checked transport or command failure visible to Studio."""

    v: Literal[1] = 1
    type: Literal["error"] = "error"
    agent_run_id: str
    code: str
    message: str
    command_id: str | None = None
    retryable: bool = False


class _ChatCommand(ChatContractModel):
    v: Literal[1] = 1
    command_id: str = Field(min_length=1, max_length=128)


class ChatStartTurnCommand(_ChatCommand):
    type: Literal["start_turn"]
    prompt: str = Field(min_length=1)

    @field_validator("prompt")
    @classmethod
    def prompt_must_contain_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("prompt must contain text")
        return value


class ChatInterruptCommand(_ChatCommand):
    type: Literal["interrupt"]


class ChatApprovalResponseCommand(_ChatCommand):
    type: Literal["respond_approval"]
    request_id: str = Field(min_length=1)
    decision: Literal["accept", "acceptForSession", "decline", "cancel"]


class ChatUserInputResponseCommand(_ChatCommand):
    type: Literal["respond_user_input"]
    request_id: str = Field(min_length=1)
    answers: dict[str, list[str]]


class ChatStopCommand(_ChatCommand):
    type: Literal["stop"]


ChatClientCommand = Annotated[
    ChatStartTurnCommand
    | ChatInterruptCommand
    | ChatApprovalResponseCommand
    | ChatUserInputResponseCommand
    | ChatStopCommand,
    Field(discriminator="type"),
]

CHAT_CLIENT_COMMAND_ADAPTER = TypeAdapter(ChatClientCommand)


ChatWireFrame = Annotated[
    ChatSnapshotFrame
    | ChatReadyFrame
    | ChatEventFrame
    | ChatCommandAckFrame
    | ChatErrorFrame
    | ChatStartTurnCommand
    | ChatInterruptCommand
    | ChatApprovalResponseCommand
    | ChatUserInputResponseCommand
    | ChatStopCommand,
    Field(discriminator="type"),
]

CHAT_WIRE_FRAME_ADAPTER = TypeAdapter(ChatWireFrame)


def chat_wire_frames_schema() -> dict[str, Any]:
    """Export the checked bidirectional ``/ws/chat`` frame contract."""

    schema = CHAT_WIRE_FRAME_ADAPTER.json_schema()
    schema.update(
        {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "title": "Chat WebSocket wire frames",
            "description": (
                "Generated by `manage.py export_chat_wire_frames` from "
                "apps/runs/chat/contracts.py. Do not edit by hand."
            ),
        }
    )
    return schema
