import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserRuntime } from "../../../runtime/browserRuntime";
import { initializeStudioRuntime } from "../../../runtime";
import { listChatSessions, normalizeChatSummary } from "./api";
import { derivePendingChatRequests } from "./requests";
import {
  canResumeChatSession,
  chatProcessHasEnded,
  unresolvedChatDeliveryUnknown,
  unresolvedChatMessageSend,
} from "./eventSemantics";
import { useChatStore } from "./store";
import { deriveChatTimelineRows } from "./timeline";
import type { ChatEvent, ChatSessionSummary } from "./types";

const at = "2026-08-08T00:00:00Z";

function event(
  sequence: number,
  eventType: string,
  payload: Record<string, unknown>,
): ChatEvent {
  return { sequence, event_type: eventType, payload, created_at: at };
}

function summary(overrides: Partial<ChatSessionSummary> = {}): ChatSessionSummary {
  return {
    agent_run_id: "chat-1",
    project_id: "project-1",
    module_id: "module-1",
    task_id: "task-1",
    agent: "codex",
    run_status: "running",
    status: "error",
    active_turn_id: null,
    started_at: at,
    ended_at: null,
    updated_at: at,
    last_error: "Initial prompt failed",
    last_sequence: 0,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  useChatStore.getState().reset();
  initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
});

describe("structured Chat projections", () => {
  it("renders native plan arrays and preserves rich command progress", () => {
    const rows = deriveChatTimelineRows({
      events: [
        event(1, "thread.turn-started", { turn: { id: "turn-1" } }),
        event(2, "thread.activity-started", {
          turnId: "turn-1",
          item: {
            id: "command-1",
            type: "commandExecution",
            command: "rg TODO",
          },
        }),
        event(3, "thread.command-output-delta", {
          turnId: "turn-1",
          itemId: "command-1",
          delta: "studio/src/App.tsx\n",
        }),
        event(4, "thread.tool-progress", {
          turnId: "turn-1",
          itemId: "command-1",
          message: "Indexed results",
        }),
        event(5, "thread.proposed-plan-upserted", {
          turnId: "turn-1",
          plan: [
            { step: "Read the code", status: "completed" },
            { step: "Patch the UI", status: "in_progress" },
          ],
        }),
      ],
      status: "running",
      activeTurnId: "turn-1",
    });

    const activity = rows.find((row) => row.kind === "activity");
    expect(activity?.kind === "activity" && activity.activity.label).toContain(
      "Running command: rg TODO",
    );
    expect(activity?.kind === "activity" && activity.activity.detail).toContain(
      "Indexed results",
    );
    const plan = rows.find((row) => row.kind === "plan");
    expect(plan?.kind === "plan" && plan.plan.steps).toEqual([
      { step: "Read the code", status: "completed" },
      { step: "Patch the UI", status: "inProgress" },
    ]);
  });

  it("renders Codex file-change patches from the pinned changes array", () => {
    const rows = deriveChatTimelineRows({
      events: [
        event(1, "thread.file-change-patch-updated", {
          itemId: "edit-1",
          turnId: "turn-1",
          changes: [
            {
              path: "studio/src/App.tsx",
              kind: "update",
              diff: "--- a/studio/src/App.tsx\n+++ b/studio/src/App.tsx\n@@ -1 +1 @@\n-old\n+new",
            },
            {
              path: "studio/src/App.test.tsx",
              kind: "add",
              diff: "--- /dev/null\n+++ b/studio/src/App.test.tsx\n@@ -0,0 +1 @@\n+test();",
            },
          ],
        }),
      ],
      status: "ready",
      activeTurnId: null,
    });

    const diff = rows.find((row) => row.kind === "diff");
    expect(diff?.kind === "diff" && diff.diff.files).toEqual([
      "studio/src/App.tsx",
      "studio/src/App.test.tsx",
    ]);
    expect(diff?.kind === "diff" && diff.diff.patch).toContain("-old\n+new");
    expect(diff?.kind === "diff" && diff.diff.patch).toContain("+test();");
  });

  it("shows MCP tool arguments/results and cumulative token usage", () => {
    const rows = deriveChatTimelineRows({
      events: [
        event(1, "thread.activity-started", {
          turnId: "turn-1",
          item: {
            id: "mcp-1",
            type: "mcpToolCall",
            server: "worktracker",
            tool: "get_work_item",
            arguments: { key: "T62" },
            status: "inProgress",
          },
        }),
        event(2, "thread.activity-completed", {
          turnId: "turn-1",
          item: {
            id: "mcp-1",
            type: "mcpToolCall",
            server: "worktracker",
            tool: "get_work_item",
            arguments: { key: "T62" },
            result: { content: [{ type: "text", text: "Chat story" }] },
            status: "completed",
          },
        }),
        event(3, "thread.token-usage-updated", {
          turnId: "turn-1",
          tokenUsage: {
            total: {
              inputTokens: 10_000,
              cachedInputTokens: 8_000,
              outputTokens: 2_000,
              reasoningOutputTokens: 345,
              totalTokens: 12_345,
            },
            last: {
              inputTokens: 1_000,
              cachedInputTokens: 800,
              outputTokens: 200,
              reasoningOutputTokens: 34,
              totalTokens: 1_234,
            },
            modelContextWindow: 200_000,
          },
        }),
      ],
      status: "ready",
      activeTurnId: null,
      expandedTurnIds: new Set(["turn-1"]),
    });

    const tool = rows.find((row) =>
      row.kind === "activity" && row.activity.id === "activity:mcp-1"
    );
    expect(tool?.kind === "activity" && tool.activity).toMatchObject({
      label: "Called worktracker.get_work_item",
      command: "worktracker.get_work_item",
      status: "completed",
    });
    expect(tool?.kind === "activity" && tool.activity.detail).toContain(
      '"key": "T62"',
    );
    expect(tool?.kind === "activity" && tool.activity.detail).toContain("Chat story");

    const usage = rows.find((row) =>
      row.kind === "activity" && row.activity.itemType === "tokenUsage"
    );
    expect(usage?.kind === "activity" && usage.activity.label)
      .toBe("12,345 tokens used");
    expect(usage?.kind === "activity" && usage.activity.detail)
      .toContain("Last turn 1,234");
  });

  it("uses nested Codex turn outcomes instead of treating every completion as worked", () => {
    useChatStore.getState().openSession(summary({ status: "ready", last_error: null }));
    useChatStore.getState().ingestEvent("chat-1", event(1, "thread.turn-started", {
      turn: { id: "turn-1" },
    }));
    useChatStore.getState().ingestEvent("chat-1", event(2, "thread.activity-started", {
      turnId: "turn-1",
      item: { id: "reason-1", type: "reasoning" },
    }));
    useChatStore.getState().ingestEvent("chat-1", event(3, "thread.turn-completed", {
      turn: { id: "turn-1", status: "interrupted" },
    }));

    let session = useChatStore.getState().sessions["chat-1"];
    expect(session.status).toBe("interrupted");
    let rows = deriveChatTimelineRows({
      events: session.events,
      status: session.status,
      activeTurnId: session.active_turn_id,
    });
    expect(rows.find((row) => row.kind === "turn-fold" && row.label.startsWith("You stopped")))
      .toBeDefined();

    useChatStore.getState().ingestEvent("chat-1", event(4, "thread.turn-started", {
      turn: { id: "turn-2" },
    }));
    useChatStore.getState().ingestEvent("chat-1", event(5, "thread.activity-started", {
      turnId: "turn-2",
      item: { id: "command-2", type: "commandExecution", command: "false" },
    }));
    useChatStore.getState().ingestEvent("chat-1", event(6, "thread.turn-completed", {
      turn: {
        id: "turn-2",
        status: "failed",
        error: { message: "Tool execution failed" },
      },
    }));

    session = useChatStore.getState().sessions["chat-1"];
    expect(session).toMatchObject({
      status: "error",
      last_error: "Tool execution failed",
      retryable_error: true,
    });
    expect(canResumeChatSession({
      status: session.status,
      events: session.events,
      retryableError: session.retryable_error,
    })).toBe(false);
    rows = deriveChatTimelineRows({
      events: session.events,
      status: session.status,
      activeTurnId: session.active_turn_id,
    });
    expect(rows.find((row) => row.kind === "turn-fold" && row.label.startsWith("Turn failed")))
      .toBeDefined();
  });

  it("keeps message delivery failures retryable on the live session", () => {
    useChatStore.getState().openSession(summary({ status: "ready", last_error: null }));
    useChatStore.getState().ingestEvent("chat-1", event(1, "thread.message-sent", {
      id: "command-1",
      command_id: "command-1",
      text: "Please inspect this.",
      deliveryState: "pending",
    }));
    useChatStore.getState().ingestEvent("chat-1", event(2, "thread.message-failed", {
      id: "command-1",
      error: { message: "turn/start rejected" },
    }));

    const failed = useChatStore.getState().sessions["chat-1"];
    expect(failed).toMatchObject({
      status: "error",
      retryable_error: true,
      last_error: "turn/start rejected",
    });
    expect(canResumeChatSession({
      status: failed.status,
      events: failed.events,
      retryableError: failed.retryable_error,
    })).toBe(false);
    const row = deriveChatTimelineRows({
      events: failed.events,
      status: failed.status,
      activeTurnId: null,
    }).find((candidate) => candidate.kind === "message");
    expect(row?.kind === "message" && row.message).toMatchObject({
      delivery: "failed",
      deliveryError: "turn/start rejected",
    });

    useChatStore.getState().ingestEvent("chat-1", event(3, "thread.turn-started", {
      turn: { id: "turn-retry" },
    }));
    expect(useChatStore.getState().sessions["chat-1"]).toMatchObject({
      status: "running",
      retryable_error: false,
      last_error: null,
    });
  });

  it("does not redeliver a restart-boundary message with an unknown outcome", () => {
    useChatStore.getState().openSession(summary({ status: "ready", last_error: null }));
    useChatStore.getState().ingestEvent("chat-1", event(1, "thread.message-sent", {
      id: "command-unknown",
      command_id: "command-unknown",
      text: "Continue after restart.",
      deliveryState: "pending",
    }));
    useChatStore.getState().ingestEvent("chat-1", event(2, "thread.message-failed", {
      id: "command-unknown",
      command_id: "command-unknown",
      deliveryUnknown: true,
      retryable: false,
      error: { message: "Ticketry restarted before delivery could be confirmed." },
    }));

    const failed = useChatStore.getState().sessions["chat-1"];
    expect(failed).toMatchObject({
      status: "error",
      retryable_error: false,
      last_error: "Ticketry restarted before delivery could be confirmed.",
    });
    const row = deriveChatTimelineRows({
      events: failed.events,
      status: failed.status,
      activeTurnId: null,
    }).find((candidate) => candidate.kind === "message");
    expect(row?.kind === "message" && row.message).toMatchObject({
      text: "Continue after restart.",
      delivery: "failed",
      deliveryRetryable: false,
      deliveryUnknownFinal: true,
    });
    expect(unresolvedChatDeliveryUnknown(failed.events)).toEqual({
      id: "command-unknown",
      sequence: 2,
    });

    expect(unresolvedChatDeliveryUnknown([
      ...failed.events,
      event(3, "thread.message-sent", {
        id: "later-command",
        command_id: "later-command",
        text: "The reviewed follow-up.",
      }),
    ])).toBeNull();
  });

  it("treats a message audit as unresolved until its provider outcome arrives", () => {
    const sent = event(1, "thread.message-sent", {
      id: "command-pending",
      command_id: "command-pending",
      text: "Start this once.",
      deliveryState: "pending",
    });
    expect(unresolvedChatMessageSend([sent])).toEqual({
      id: "command-pending",
      ids: ["command-pending"],
      text: "Start this once.",
      sequence: 1,
    });
    expect(unresolvedChatMessageSend([
      sent,
      event(2, "thread.turn-started", { turn: { id: "turn-1" } }),
    ])).toBeNull();
    expect(unresolvedChatMessageSend([
      sent,
      event(2, "thread.message-failed", {
        id: "command-pending",
        error: "Provider rejected the turn.",
      }),
    ])).toBeNull();
  });

  it("offers Resume only for the latest process-lifetime transition", () => {
    const restart = event(1, "thread.session-interrupted", { resumable: true });
    expect(canResumeChatSession({
      status: "stopped",
      events: [event(1, "thread.session-stopped", { resumable: true })],
      retryableError: false,
    })).toBe(false);
    expect(canResumeChatSession({
      status: "interrupted",
      events: [restart],
      retryableError: false,
    })).toBe(true);
    expect(canResumeChatSession({
      status: "interrupted",
      events: [
        restart,
        event(2, "thread.turn-started", { turn: { id: "ordinary" } }),
        event(3, "thread.turn-completed", {
          turn: { id: "ordinary", status: "interrupted" },
        }),
      ],
      retryableError: false,
    })).toBe(false);
    expect(canResumeChatSession({
      status: "error",
      events: [event(1, "thread.session-exited", {
        status: "error",
        resumable: true,
      })],
      retryableError: false,
    })).toBe(true);
    expect(canResumeChatSession({
      status: "error",
      events: [event(1, "thread.message-failed", { id: "message-1" })],
      retryableError: true,
    })).toBe(false);
    expect(canResumeChatSession({
      status: "error",
      events: [event(1, "thread.error", {
        phase: "backend_restart",
        resumable: false,
        message: "Backend restarted before Codex created a thread",
      })],
      retryableError: false,
      runStatus: "exited",
    })).toBe(false);
    expect(chatProcessHasEnded({
      status: "error",
      runStatus: "exited",
      endedAt: at,
    })).toBe(true);
  });

  it("leaves ended history closed until explicitly reopened", () => {
    const ended = summary({
      status: "stopped",
      run_status: "terminated",
      ended_at: at,
      last_error: null,
    });
    useChatStore.getState().hydrateTask("task-1", [ended]);
    expect(useChatStore.getState().sessions["chat-1"]).toBeUndefined();
    useChatStore.getState().openSession(ended, true);
    expect(useChatStore.getState().sessions["chat-1"]).toBeDefined();
  });

  it("keeps a live error session mounted across list hydration", () => {
    const liveError = summary({
      status: "error",
      run_status: "running",
      ended_at: null,
      last_error: "turn/start rejected",
    });
    useChatStore.getState().hydrateTask("task-1", [liveError]);
    const session = useChatStore.getState().sessions["chat-1"];
    expect(session).toMatchObject({ status: "error", run_status: "running" });
    expect(canResumeChatSession({
      status: session.status,
      events: session.events,
      retryableError: session.retryable_error,
      runStatus: session.run_status,
    })).toBe(false);
  });

  it("keeps a failed optional initial turn usable and clears errors while resuming", () => {
    useChatStore.getState().openSession(summary());
    useChatStore.getState().installSnapshot("chat-1", {
      run: summary({ last_sequence: 1 }),
      session: {
        status: "error",
        active_turn_id: null,
        last_error: "Initial prompt failed",
      },
      events: [event(1, "thread.error", {
        phase: "initial_turn",
        message: "Initial prompt failed",
      })],
      cursor: 1,
    });
    expect(useChatStore.getState().sessions["chat-1"]).toMatchObject({
      status: "ready",
      last_error: "Initial prompt failed",
    });

    useChatStore.getState().markResuming("chat-1");
    expect(useChatStore.getState().sessions["chat-1"]).toMatchObject({
      status: "starting",
      last_error: null,
      transport_error: null,
    });
  });

  it("tracks pending approvals and structured user-input until their response events", () => {
    const pending = derivePendingChatRequests([
      event(1, "thread.approval-response-requested", {
        requestId: "approval-1",
        requestKind: "item/commandExecution/requestApproval",
        payload: { command: "npm test", reason: "Run the suite" },
      }),
      event(2, "thread.user-input-response-requested", {
        requestId: "input-1",
        requestKind: "item/tool/requestUserInput",
        payload: {
          questions: [{
            id: "scope",
            header: "Scope",
            question: "Which package?",
            options: [{ label: "Studio", description: "Frontend only" }],
            isOther: true,
            isSecret: true,
          }],
        },
      }),
    ]);
    expect(pending.approvals[0]).toMatchObject({
      requestId: "approval-1",
      requestKind: "command",
      detail: "npm test\nRun the suite",
      availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
    });
    expect(pending.userInputs[0]?.questions[0]).toMatchObject({
      id: "scope",
      allowOther: true,
      isSecret: true,
    });

    const resolved = derivePendingChatRequests([
      ...[
        event(1, "thread.approval-response-requested", {
          requestId: "approval-1",
          requestKind: "item/commandExecution/requestApproval",
          payload: {},
        }),
        event(2, "thread.user-input-response-requested", {
          requestId: "input-1",
          payload: { questions: [] },
        }),
      ],
      event(3, "thread.approval-responded", { requestId: "approval-1" }),
      event(4, "thread.user-input-responded", { requestId: "input-1" }),
    ]);
    expect(resolved).toEqual({ approvals: [], userInputs: [] });

    const abandoned = derivePendingChatRequests([
      event(1, "thread.approval-response-requested", {
        requestId: "approval-orphan",
        payload: { turnId: "turn-orphan", command: "npm test" },
      }),
      event(2, "thread.session-interrupted", { resumable: true }),
    ]);
    expect(abandoned).toEqual({ approvals: [], userInputs: [] });
  });

  it("settles a streaming turn when the provider process exits without turn/completed", () => {
    const rows = deriveChatTimelineRows({
      events: [
        event(1, "thread.turn-started", { turn: { id: "turn-crash" } }),
        event(2, "thread.activity-started", {
          turnId: "turn-crash",
          item: { id: "reason-crash", type: "reasoning" },
        }),
        event(3, "thread.message-assistant-delta", {
          turnId: "turn-crash",
          itemId: "assistant-crash",
          delta: "Partial response",
        }),
        event(4, "thread.session-exited", {
          status: "error",
          error: "app-server exited",
        }),
      ],
      status: "error",
      activeTurnId: null,
    });

    const assistant = rows.find((row) =>
      row.kind === "message" && row.message.role === "assistant"
    );
    expect(assistant?.kind === "message" && assistant.message.streaming).toBe(false);
    expect(rows.find((row) => row.kind === "turn-fold" && row.label.startsWith("Turn failed")))
      .toBeDefined();
  });
});

describe("Chat REST authentication", () => {
  it("retains AgentRun process status separately from Chat session status", () => {
    expect(normalizeChatSummary({
      agent_run_id: "chat-live-error",
      project_id: "project-1",
      module_id: "module-1",
      task_id: "task-1",
      status: "error",
      run_status: "running",
      ended_at: null,
      last_error: "turn/start rejected",
      last_sequence: 4,
    })).toMatchObject({
      status: "error",
      run_status: "running",
      ended_at: null,
    });
  });

  it("sends the configured x-api-key", async () => {
    initializeStudioRuntime(createBrowserRuntime({
      environment: { VITE_WT_API_KEY: "chat-secret" },
    }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("[]", { headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await listChatSessions("task-1");

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("x-api-key")).toBe("chat-secret");
  });
});
