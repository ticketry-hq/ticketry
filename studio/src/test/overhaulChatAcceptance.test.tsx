import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { useAgentStatusStore } from "../features/agents/status";
import { useChatStore } from "../features/agents/chat";
import { ChatHost } from "../features/agents/chat/ChatHost";
import { useTerminalStore } from "../features/agents/terminal";
import { useStudioStore } from "../features/projects/store";
import { seedConfig } from "../features/studio/stores/configStore";
import { queryClient } from "../shared/query/queryClient";
import { useClientStore } from "../state/clientStore";

interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const at = (second: number) => `2026-08-08T12:00:${String(second).padStart(2, "0")}Z`;

function chatEvent(
  sequence: number,
  eventType: string,
  payload: Record<string, unknown>,
) {
  return {
    sequence,
    event_type: eventType,
    payload,
    created_at: at(sequence),
  };
}

function chatRun(status: string, lastSequence: number) {
  return {
    agent_run_id: "chat-1",
    project_id: "project-1",
    module_id: "module-1",
    task_id: "story-1",
    agent: "codex",
    run_status: "running",
    run_kind: "chat",
    scope: "task",
    status,
    started_at: at(0),
    ended_at: null,
    updated_at: at(lastSequence),
    last_sequence: lastSequence,
  };
}

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly sent: string[] = [];
  readyState = FakeWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent<string>);
  }

  send(data: string): void {
    this.sent.push(String(data));
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new Event("close") as CloseEvent);
  }
}

function commands(socket: FakeWebSocket): Array<Record<string, unknown>> {
  return socket.sent.map((payload) => JSON.parse(payload) as Record<string, unknown>);
}

describe("overhaul acceptance — Codex Chat", () => {
  const requests: RecordedRequest[] = [];

  beforeEach(() => {
    requests.length = 0;
    FakeWebSocket.instances = [];
    localStorage.clear();
    queryClient.clear();
    seedConfig({ features: { sidebar: true, projects: true } });
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useClientStore.setState({
      selectedModuleId: "module-1",
      selectedTaskId: "story-1",
      workspaceSelection: { kind: "task" },
      workspaces: {},
      activeByTask: {},
      sidebarVisible: true,
      toasts: [],
      dialogs: [],
    });
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useChatStore.getState().reset();
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: {},
      automationAttempts: {},
      automationByTask: {},
    });

    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("fetch", vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(request?.url ?? String(input), window.location.href);
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      const rawBody = init?.body ?? (request ? await request.clone().text() : null);
      const body = typeof rawBody === "string" && rawBody
        ? JSON.parse(rawBody)
        : rawBody ?? null;
      requests.push({ method, path: `${url.pathname}${url.search}`, body });

      if (method === "GET" && url.pathname === "/api/work-tracker/providers") {
        return json([{
          id: "provider-codex",
          slug: "codex",
          activated: true,
          supports_unattended: true,
        }]);
      }
      if (method === "GET" && url.pathname === "/api/work-tracker/models") {
        return json([]);
      }
      if (method === "GET" && url.pathname === "/api/terminals") return json([]);
      if (method === "GET" && url.pathname === "/api/documents") {
        return json({ documents: [] });
      }
      if (method === "GET" && url.pathname === "/api/chats") {
        const created = requests.some((candidate) =>
          candidate.method === "POST" && candidate.path === "/api/chats"
        );
        return json(created ? [chatRun("ready", 0)] : []);
      }
      if (method === "POST" && url.pathname === "/api/chats") {
        return json({ agent_run_id: "chat-1" }, 201);
      }
      if (method === "POST" && url.pathname === "/api/chats/chat-1/resume") {
        return json({ agent_run_id: "chat-1", resumed: true });
      }
      if (method === "GET" && url.pathname === "/api/chats/chat-1") {
        return json({
          run: chatRun("ready", 11),
          session: {
            status: "ready",
            active_turn_id: null,
            last_error: null,
            next_sequence: 12,
            updated_at: at(11),
          },
          events: [],
          cursor: 11,
        });
      }
      return json([]);
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("[overhaul-23] opens a first-class Chat run and drives its durable conversation", async () => {
    render(
      <SelectedTicketContent
        bucket="story-1"
        projectId="project-1"
        moduleId="module-1"
        ticketKey="MEML-1"
        owner="studio"
        details={<div>Story details</div>}
        launchContext={{
          kind: "task",
          projectId: "project-1",
          moduleId: "module-1",
          taskId: "story-1",
          taskKey: "MEML-1",
          taskName: "Checkout story",
          ticketSeq: 1,
          profileReady: true,
          profile: null,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    expect(await screen.findByRole("menuitem", { name: "Codex · Chat" }))
      .toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Codex · Terminal" }))
      .toBeVisible();

    fireEvent.click(screen.getByRole("menuitem", { name: "Codex · Chat" }));

    await waitFor(() => {
      expect(requests.find((request) =>
        request.method === "POST" && request.path === "/api/chats"
      )?.body).toEqual(expect.objectContaining({
        agent: "codex",
        project_id: "project-1",
        module_id: "module-1",
        task_id: "story-1",
        initial_prompt: null,
        is_planning: false,
        is_instant: false,
        instant_prompt: null,
        command_id: expect.any(String),
      }));
    });
    expect(requests.some((request) =>
      request.method === "POST" && request.path.startsWith("/api/terminals")
    )).toBe(false);
    expect(screen.queryByRole("tab", { name: /Terminal/ })).toBeNull();
    const launchedTab = await screen.findByRole("tab", { name: "Codex Chat" });
    expect(launchedTab).toHaveAttribute("aria-selected", "true");
    const controlledPanel = document.getElementById(
      launchedTab.getAttribute("aria-controls")!,
    );
    expect(controlledPanel).toHaveAttribute("role", "tabpanel");
    expect(controlledPanel).toHaveAttribute("aria-labelledby", launchedTab.id);

    // Shared workspace tabs follow the ARIA automatic-activation keyboard model.
    fireEvent.keyDown(launchedTab, { key: "ArrowLeft" });
    const detailsTab = screen.getByRole("tab", { name: "Details" });
    await waitFor(() => expect(detailsTab).toHaveFocus());
    expect(detailsTab).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(detailsTab, { key: "ArrowRight" });
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Codex Chat" })).toHaveFocus();
    });

    let chat = await screen.findByTestId(
      "chat-host-chat-1",
      {},
      { timeout: 5_000 },
    );
    await waitFor(
      () => expect(FakeWebSocket.instances).toHaveLength(1),
      { timeout: 5_000 },
    );
    const socket = FakeWebSocket.instances.at(-1)!;
    expect(socket.url).toContain("/ws/chat?");
    expect(socket.url).toContain("agent_run_id=chat-1");

    const replay = [
      chatEvent(1, "thread.message-sent", {
        id: "message-1",
        turn_id: "turn-1",
        text: "Inspect the checkout code.",
      }),
      chatEvent(2, "thread.turn-started", { turn: { id: "turn-1" } }),
      chatEvent(3, "thread.activity-started", {
        turn_id: "turn-1",
        item: {
          id: "tool-1",
          type: "commandExecution",
          command: "rg checkout studio/src",
        },
      }),
      chatEvent(4, "thread.reasoning-delta", {
        turn_id: "turn-1",
        item_id: "reasoning-1",
        delta: "Tracing the existing launch and workspace state.",
      }),
      chatEvent(5, "thread.message-assistant-delta", {
        turn_id: "turn-1",
        item_id: "assistant-1",
        delta: "I found the **checkout** path and `launchChatSession`.",
      }),
      chatEvent(6, "thread.proposed-plan-upserted", {
        turn_id: "turn-1",
        explanation: "Reuse the existing run boundary.",
        plan: [
          { step: "Trace the current launch path", status: "completed" },
          { step: "Wire Chat beside Terminal", status: "inProgress" },
        ],
      }),
      chatEvent(7, "thread.file-change-patch-updated", {
        turn_id: "turn-1",
        item_id: "edit-1",
        changes: [
          {
            path: "studio/src/features/agents/chat/ChatHost.tsx",
            kind: "update",
            diff: "--- a/ChatHost.tsx\n+++ b/ChatHost.tsx\n@@ -1 +1 @@\n-old\n+new",
          },
          {
            path: "studio/src/features/agents/chat/ChatHost.test.tsx",
            kind: "add",
            diff: "--- /dev/null\n+++ b/ChatHost.test.tsx\n@@ -0,0 +1 @@\n+test();",
          },
        ],
      }),
      chatEvent(8, "thread.activity-started", {
        turn_id: "turn-1",
        item: {
          id: "mcp-1",
          type: "mcpToolCall",
          server: "worktracker",
          tool: "get_work_item",
          arguments: { key: "T62" },
          status: "inProgress",
        },
      }),
      chatEvent(9, "thread.activity-completed", {
        turn_id: "turn-1",
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
      chatEvent(10, "thread.token-usage-updated", {
        turn_id: "turn-1",
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
      chatEvent(11, "thread.approval-response-requested", {
        request_id: "approval-1",
        requestKind: "commandExecutionApproval",
        payload: { turnId: "turn-1", command: "npm test" },
      }),
    ];
    await act(async () => {
      socket.open();
      socket.receive({
        v: 1,
        type: "snapshot",
        agent_run_id: "chat-1",
        run: chatRun("running", 11),
        session: {
          status: "running",
          active_turn_id: "turn-1",
          last_error: null,
          next_sequence: 12,
          updated_at: at(11),
        },
        events: replay,
        cursor: 11,
      });
      socket.receive({
        v: 1,
        type: "ready",
        agent_run_id: "chat-1",
        cursor: 11,
      });
    });

    expect(within(chat).getByText("Inspect the checkout code.")).toBeVisible();
    expect(within(chat).getByText("checkout").tagName).toBe("STRONG");
    expect(within(chat).getByText("launchChatSession").tagName).toBe("CODE");
    expect(within(chat).getByText("Reasoning")).toBeVisible();
    expect(within(chat).getByText("Running command: rg checkout studio/src"))
      .toBeVisible();
    const mcpTool = within(chat).getByText("Called worktracker.get_work_item");
    expect(mcpTool).toBeVisible();
    fireEvent.click(mcpTool);
    expect(within(chat).getByText(/"key": "T62"/)).toBeVisible();
    expect(within(chat).getByText("12,345 tokens used")).toBeVisible();
    expect(within(chat).getByText("Reuse the existing run boundary.")).toBeVisible();
    expect(within(chat).getByText("Trace the current launch path")).toBeVisible();
    expect(within(chat).getByText("Wire Chat beside Terminal")).toBeVisible();
    expect(within(chat).getByText("Completed:")).toHaveClass("sr-only");
    const diff = within(chat).getByText(/Changes in 2 files/);
    fireEvent.click(diff);
    expect(within(chat).getByText("studio/src/features/agents/chat/ChatHost.tsx"))
      .toBeVisible();
    expect(within(chat).getByText("+new")).toBeVisible();

    const approval = within(chat).getByRole("region", {
      name: "Pending Codex approval",
    });
    await waitFor(() => expect(approval).toHaveFocus());
    expect(within(approval).getByText("Command approval requested")).toBeVisible();
    expect(within(approval).getByText("npm test")).toBeVisible();
    fireEvent.click(within(approval).getByRole("button", { name: "Approve once" }));
    await waitFor(() => {
      expect(commands(socket).some((command) =>
        command.type === "respond_approval" &&
        command.request_id === "approval-1" &&
        command.decision === "accept"
      )).toBe(true);
    });
    const approvalResponse = commands(socket).find(
      (command) => command.type === "respond_approval",
    )!;
    await act(async () => {
      socket.receive({
        v: 1,
        type: "event",
        agent_run_id: "chat-1",
        event: chatEvent(12, "thread.approval-responded", {
          request_id: "approval-1",
          decision: "accept",
        }),
      });
      socket.receive({
        v: 1,
        type: "ack",
        agent_run_id: "chat-1",
        command_id: approvalResponse.command_id,
        command: "respond_approval",
        result: { accepted: true },
      });
    });
    await waitFor(() => {
      expect(within(chat).queryByRole("region", {
        name: "Pending Codex approval",
      })).toBeNull();
    });

    await act(async () => {
      socket.receive({
        v: 1,
        type: "event",
        agent_run_id: "chat-1",
        event: chatEvent(13, "thread.user-input-response-requested", {
          request_id: "input-1",
          requestKind: "item/tool/requestUserInput",
          payload: {
            turnId: "turn-1",
            questions: [
              {
                id: "scope",
                header: "Scope",
                question: "Which surface?",
                options: [{ label: "Studio", description: "Desktop UI" }],
              },
              {
                id: "token",
                header: "Token",
                question: "Enter the temporary token",
                options: [],
                isOther: true,
                isSecret: true,
              },
            ],
          },
        }),
      });
    });
    const inputPanel = within(chat).getByRole("region", { name: "Codex needs input" });
    await waitFor(() => expect(inputPanel).toHaveFocus());
    fireEvent.click(within(inputPanel).getByRole("radio", { name: /Studio/ }));
    const token = within(inputPanel).getByLabelText("Token answer");
    expect(token).toHaveAttribute("type", "password");
    fireEvent.change(token, { target: { value: "temporary-secret" } });
    fireEvent.click(within(inputPanel).getByRole("button", { name: "Submit answers" }));
    await waitFor(() => {
      expect(commands(socket).some((command) =>
        command.type === "respond_user_input" &&
        command.request_id === "input-1" &&
        JSON.stringify(command.answers) === JSON.stringify({
          scope: ["Studio"],
          token: ["temporary-secret"],
        })
      )).toBe(true);
    });
    const inputResponse = commands(socket).find(
      (command) => command.type === "respond_user_input",
    )!;
    await act(async () => {
      socket.receive({
        v: 1,
        type: "event",
        agent_run_id: "chat-1",
        event: chatEvent(14, "thread.user-input-responded", {
          request_id: "input-1",
        }),
      });
      socket.receive({
        v: 1,
        type: "ack",
        agent_run_id: "chat-1",
        command_id: inputResponse.command_id,
        command: "respond_user_input",
        result: { accepted: true },
      });
    });

    fireEvent.click(within(chat).getByRole("button", { name: "Stop" }));
    await waitFor(() => {
      expect(commands(socket).some((command) => command.type === "interrupt"))
        .toBe(true);
    });
    const interrupt = commands(socket).find((command) => command.type === "interrupt")!;
    await act(async () => {
      socket.receive({
        v: 1,
        type: "event",
        agent_run_id: "chat-1",
        event: chatEvent(15, "thread.turn-completed", {
          turn: { id: "turn-1", status: "interrupted" },
        }),
      });
      socket.receive({
        v: 1,
        type: "ack",
        agent_run_id: "chat-1",
        command_id: interrupt.command_id,
        command: "interrupt",
        result: { interrupted: true },
      });
    });

    await waitFor(() => {
      expect(within(chat).getByText("Stopped response")).toBeVisible();
      expect(within(chat).getByRole("button", { name: /You stopped/ })).toBeVisible();
      expect(within(chat).getByText("12,345 tokens used")).toBeVisible();
      expect(within(chat).queryByRole("button", { name: "Resume" })).toBeNull();
    });

    await act(async () => {
      socket.receive({
        v: 1,
        type: "event",
        agent_run_id: "chat-1",
        event: chatEvent(16, "thread.session-interrupted", { resumable: true }),
      });
    });

    fireEvent.click(await within(chat).findByRole("button", { name: "Resume" }));
    await waitFor(() => {
      expect(requests.some((request) =>
        request.method === "POST" && request.path === "/api/chats/chat-1/resume"
      )).toBe(true);
      expect(within(chat).getByText("Ready")).toBeVisible();
    });

    fireEvent.change(within(chat).getByRole("textbox", { name: "Message Codex" }), {
      target: { value: "Show me the smallest safe change." },
    });
    fireEvent.click(within(chat).getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(commands(socket).some((command) =>
        command.type === "start_turn" &&
        command.prompt === "Show me the smallest safe change."
      )).toBe(true);
    });
    const failedTurnCommand = commands(socket).find((command) =>
      command.type === "start_turn" &&
      command.prompt === "Show me the smallest safe change."
    )!;
    await act(async () => {
      socket.receive({
        v: 1,
        type: "event",
        agent_run_id: "chat-1",
        event: chatEvent(17, "thread.message-sent", {
          id: "message-2",
          command_id: failedTurnCommand.command_id,
          text: "Show me the smallest safe change.",
          deliveryState: "pending",
        }),
      });
      socket.receive({
        v: 1,
        type: "event",
        agent_run_id: "chat-1",
        event: chatEvent(18, "thread.turn-started", { turn: { id: "turn-2" } }),
      });
      socket.receive({
        v: 1,
        type: "event",
        agent_run_id: "chat-1",
        event: chatEvent(19, "thread.activity-started", {
          turnId: "turn-2",
          item: { id: "command-2", type: "commandExecution", command: "npm test" },
        }),
      });
      socket.receive({
        v: 1,
        type: "event",
        agent_run_id: "chat-1",
        event: chatEvent(20, "thread.turn-completed", {
          turn: {
            id: "turn-2",
            status: "failed",
            error: { message: "Build failed" },
          },
        }),
      });
      socket.receive({
        v: 1,
        type: "ack",
        agent_run_id: "chat-1",
        command_id: failedTurnCommand.command_id,
        command: "start_turn",
        result: { accepted: true },
      });
    });
    await waitFor(() => {
      expect(within(chat).getByText("Error")).toBeVisible();
      expect(within(chat).getByText("Build failed")).toBeVisible();
      expect(within(chat).getByRole("button", { name: /Turn failed/ })).toBeVisible();
      expect(within(chat).queryByRole("button", { name: "Resume" })).toBeNull();
      expect(within(chat).getByRole("textbox", { name: "Message Codex" }))
        .not.toBeDisabled();
    });

    fireEvent.change(within(chat).getByRole("textbox", { name: "Message Codex" }), {
      target: { value: "Retry the rejected delivery." },
    });
    fireEvent.click(within(chat).getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(commands(socket).some((command) =>
        command.type === "start_turn" && command.prompt === "Retry the rejected delivery."
      )).toBe(true);
    });
    const rejectedCommand = commands(socket).find((command) =>
      command.type === "start_turn" && command.prompt === "Retry the rejected delivery."
    )!;
    await act(async () => {
      socket.receive({
        v: 1,
        type: "event",
        agent_run_id: "chat-1",
        event: chatEvent(21, "thread.message-sent", {
          id: "message-3",
          command_id: rejectedCommand.command_id,
          text: "Retry the rejected delivery.",
          deliveryState: "pending",
        }),
      });
      socket.receive({
        v: 1,
        type: "event",
        agent_run_id: "chat-1",
        event: chatEvent(22, "thread.message-failed", {
          id: "message-3",
          command_id: rejectedCommand.command_id,
          error: { message: "turn/start rejected" },
        }),
      });
      socket.receive({
        v: 1,
        type: "error",
        agent_run_id: "chat-1",
        command_id: rejectedCommand.command_id,
        code: "turn_start_failed",
        message: "turn/start rejected",
        retryable: false,
      });
    });
    const rejectedMessage = within(chat)
      .getAllByText("Retry the rejected delivery.")
      .map((element) => element.closest<HTMLElement>("[data-testid=chat-message-user]"))
      .find((element): element is HTMLElement => element !== null)!;
    await waitFor(() => {
      expect(within(rejectedMessage).getByText("Not sent")).toBeVisible();
      expect(within(rejectedMessage).getByRole("button", { name: "Retry message" }))
        .toBeVisible();
      expect(within(chat).queryByRole("button", { name: "Resume" })).toBeNull();
    });

    // A recovered command can sit on the crash boundary: Ticketry knows the
    // message was durably staged, but cannot prove whether Codex accepted the
    // turn. A fresh-id retry could duplicate work, so the transcript keeps the
    // ambiguity visible and offers no redelivery action.
    await act(async () => {
      socket.receive({
        v: 1,
        type: "event",
        agent_run_id: "chat-1",
        event: chatEvent(23, "thread.message-sent", {
          id: "restart-boundary-command",
          command_id: "restart-boundary-command",
          text: "Backend restart delivery.",
          deliveryState: "pending",
        }),
      });
      socket.receive({
        v: 1,
        type: "event",
        agent_run_id: "chat-1",
        event: chatEvent(24, "thread.message-failed", {
          id: "restart-boundary-command",
          command_id: "restart-boundary-command",
          deliveryUnknown: true,
          retryable: false,
          error: {
            message: "Ticketry backend restarted before turn delivery could be confirmed.",
          },
        }),
      });
    });
    const restartBoundaryMessage = within(chat)
      .getByText("Backend restart delivery.")
      .closest<HTMLElement>("[data-testid=chat-message-user]")!;
    await waitFor(() => {
      expect(within(restartBoundaryMessage).getByText("Delivery outcome unknown"))
        .toBeVisible();
      expect(within(restartBoundaryMessage).getByText(
        /cannot safely redeliver this turn after restart/i,
      )).toBeVisible();
      expect(within(restartBoundaryMessage).queryByRole("button", {
        name: "Retry message",
      })).toBeNull();
      expect(within(restartBoundaryMessage).queryByRole("button", {
        name: "Retry delivery",
      })).toBeNull();
      expect(within(chat).getByText(
        "Review the resumed thread before continuing",
      )).toBeVisible();
    });

    fireEvent.change(within(chat).getByRole("textbox", { name: "Message Codex" }), {
      target: { value: "This acknowledgement may be lost." },
    });
    expect(within(chat).getByRole("button", { name: "Send" })).toBeDisabled();
    fireEvent.click(within(chat).getByRole("button", {
      name: "I reviewed the thread",
    }));
    await waitFor(() => {
      expect(within(chat).getByRole("button", { name: "Send" })).not.toBeDisabled();
    });
    fireEvent.click(within(chat).getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(commands(socket).some((command) =>
        command.type === "start_turn" && command.prompt === "This acknowledgement may be lost."
      )).toBe(true);
    });
    const uncertainCommand = commands(socket).find((command) =>
      command.type === "start_turn" &&
      command.prompt === "This acknowledgement may be lost."
    )!;
    await act(async () => socket.close());
    const uncertainMessage = await within(chat).findByText(
      "This acknowledgement may be lost.",
    );
    const uncertainRow = uncertainMessage.closest<HTMLElement>(
      "[data-testid=chat-message-user]",
    )!;
    await waitFor(() => {
      expect(within(uncertainRow).getByText("Delivery unconfirmed")).toBeVisible();
      expect(within(uncertainRow).queryByRole("button", { name: "Retry message" }))
        .toBeNull();
      expect(within(uncertainRow).getByRole("button", { name: "Retry delivery" }))
        .toBeVisible();
      expect(within(chat).getByText("Waiting to confirm prior message delivery"))
        .toBeVisible();
      expect(within(chat).getByRole("textbox", { name: "Message Codex" }))
        .toHaveValue("");
    });
    fireEvent.change(within(chat).getByRole("textbox", { name: "Message Codex" }), {
      target: { value: "Do not race this message." },
    });
    expect(within(chat).getByRole("button", { name: "Send" })).toBeDisabled();

    // Offline retry uses the same durable command id through REST. It remains
    // unconfirmed until replay proves whether the server received it.
    fireEvent.click(within(uncertainRow).getByRole("button", {
      name: "Retry delivery",
    }));
    await waitFor(() => {
      expect(requests.some((request) =>
        request.method === "POST" &&
        request.path === "/api/chats/chat-1/turns" &&
        (request.body as Record<string, unknown>)?.command_id ===
          uncertainCommand.command_id &&
        (request.body as Record<string, unknown>)?.prompt ===
          "This acknowledgement may be lost."
      )).toBe(true);
    });

    // If the first request never arrived, reconnect can safely submit the very
    // same id once. The durable message event then clears the send interlock.
    await waitFor(
      () => expect(FakeWebSocket.instances.length).toBeGreaterThan(1),
      { timeout: 3_000 },
    );
    const retrySocket = FakeWebSocket.instances.at(-1)!;
    await act(async () => {
      retrySocket.open();
      retrySocket.receive({
        v: 1,
        type: "snapshot",
        agent_run_id: "chat-1",
        run: chatRun("ready", 24),
        session: {
          status: "ready",
          active_turn_id: null,
          last_error: null,
          next_sequence: 25,
          updated_at: at(24),
        },
        events: [],
        cursor: 24,
      });
      retrySocket.receive({
        v: 1,
        type: "ready",
        agent_run_id: "chat-1",
        cursor: 24,
      });
    });
    fireEvent.click(within(uncertainRow).getByRole("button", {
      name: "Retry delivery",
    }));
    await waitFor(() => {
      expect(commands(retrySocket)).toContainEqual(expect.objectContaining({
        type: "start_turn",
        command_id: uncertainCommand.command_id,
        prompt: "This acknowledgement may be lost.",
      }));
    });
    await act(async () => {
      retrySocket.receive({
        v: 1,
        type: "event",
        agent_run_id: "chat-1",
        event: chatEvent(25, "thread.message-sent", {
          id: uncertainCommand.command_id,
          command_id: uncertainCommand.command_id,
          text: "This acknowledgement may be lost.",
          deliveryState: "pending",
        }),
      });
      retrySocket.receive({
        v: 1,
        type: "event",
        agent_run_id: "chat-1",
        event: chatEvent(26, "thread.turn-started", {
          turn: { id: "turn-3" },
        }),
      });
      retrySocket.receive({
        v: 1,
        type: "ack",
        agent_run_id: "chat-1",
        command_id: uncertainCommand.command_id,
        command: "start_turn",
        result: { turn_id: "turn-3" },
      });
    });
    await waitFor(() => {
      expect(within(chat).queryByText("Waiting to confirm prior message delivery"))
        .toBeNull();
      expect(within(chat).queryByRole("button", { name: "Retry delivery" }))
        .toBeNull();
    });
    await act(async () => retrySocket.close());

    // Closing stops the process before dismissing, then history stays
    // lightweight until explicitly reopened. Treat this webview's stopped
    // snapshot as stale: another window may already have resumed the run, so
    // Close must still ask the backend to stop it authoritatively.
    useChatStore.getState().setStatus("chat-1", "stopped", null);
    fireEvent.click(screen.getByRole("button", { name: "Close Codex Chat" }));
    await waitFor(() => {
      expect(requests.some((request) =>
        request.method === "DELETE" && request.path === "/api/chats/chat-1"
      )).toBe(true);
      expect(screen.queryByRole("tab", { name: "Codex Chat" })).toBeNull();
    });
    const reopen = await screen.findByRole("button", { name: "Reopen Codex Chat" });
    expect(screen.queryByTestId("chat-host-chat-1")).toBeNull();
    fireEvent.click(reopen);
    expect(await screen.findByRole("tab", { name: "Codex Chat" }))
      .toHaveAttribute("aria-selected", "true");
    chat = await screen.findByTestId("chat-host-chat-1");
    expect(screen.getAllByTestId("chat-host-chat-1")).toHaveLength(1);
  }, 15_000);

  it("ends a Chat through REST while a live turn acknowledgement is pending", async () => {
    useChatStore.getState().openSession({
      agent_run_id: "chat-1",
      project_id: "project-1",
      module_id: "module-1",
      task_id: "story-1",
      agent: "codex",
      run_status: "running",
      status: "ready",
      active_turn_id: null,
      started_at: at(0),
      ended_at: null,
      updated_at: at(0),
      last_error: null,
      last_sequence: 0,
    });

    render(<ChatHost agentRunId="chat-1" />);
    const chat = await screen.findByTestId("chat-host-chat-1");
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    await act(async () => {
      socket.open();
      socket.receive({
        v: 1,
        type: "ready",
        agent_run_id: "chat-1",
        cursor: 0,
      });
    });

    fireEvent.change(within(chat).getByRole("textbox", { name: "Message Codex" }), {
      target: { value: "Begin a turn that has not acknowledged yet." },
    });
    fireEvent.click(within(chat).getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(commands(socket)).toContainEqual(expect.objectContaining({
        type: "start_turn",
        prompt: "Begin a turn that has not acknowledged yet.",
      }));
    });
    const pendingTurn = commands(socket).find(
      (command) => command.type === "start_turn",
    )!;

    fireEvent.click(within(chat).getByRole("button", { name: "End session" }));
    await waitFor(() => {
      expect(requests).toContainEqual(expect.objectContaining({
        method: "DELETE",
        path: "/api/chats/chat-1",
      }));
      expect(within(chat).getByText("Session ended")).toBeVisible();
    });
    expect(commands(socket).some((command) => command.type === "stop")).toBe(false);

    // Settle the deliberately pending command so teardown has no unresolved
    // transport promise; termination was already completed independently.
    await act(async () => {
      socket.receive({
        v: 1,
        type: "ack",
        agent_run_id: "chat-1",
        command_id: pendingTurn.command_id,
        command: "start_turn",
        result: { turn_id: "turn-after-stop" },
      });
    });
  });

  it("keeps the composer interlocked for a partial durable message audit", async () => {
    useChatStore.getState().openSession({
      agent_run_id: "chat-1",
      project_id: "project-1",
      module_id: "module-1",
      task_id: "story-1",
      agent: "codex",
      run_status: "running",
      status: "ready",
      active_turn_id: null,
      started_at: at(0),
      ended_at: null,
      updated_at: at(0),
      last_error: null,
      last_sequence: 0,
    });
    useChatStore.getState().ingestEvent("chat-1", chatEvent(1, "thread.message-sent", {
      id: "partially-replayed-command",
      command_id: "partially-replayed-command",
      text: "This provider outcome is not known yet.",
      deliveryState: "pending",
    }));

    render(<ChatHost agentRunId="chat-1" />);
    const chat = await screen.findByTestId("chat-host-chat-1");
    const composer = within(chat).getByRole("textbox", { name: "Message Codex" });
    fireEvent.change(composer, { target: { value: "Do not race this turn." } });
    expect(within(chat).getByText("Waiting to confirm prior message delivery"))
      .toBeVisible();
    expect(within(chat).getByRole("button", { name: "Send" })).toBeDisabled();

    await act(async () => {
      useChatStore.getState().ingestEvent("chat-1", chatEvent(2, "thread.turn-started", {
        turn: { id: "confirmed-turn" },
      }));
      useChatStore.getState().ingestEvent("chat-1", chatEvent(3, "thread.turn-completed", {
        turn: { id: "confirmed-turn", status: "completed" },
      }));
    });
    await waitFor(() => {
      expect(within(chat).queryByText("Waiting to confirm prior message delivery"))
        .toBeNull();
      expect(within(chat).getByRole("button", { name: "Send" })).not.toBeDisabled();
    });
  });

  it("guards a slow Chat create request against duplicate launcher clicks", async () => {
    const defaultFetch = globalThis.fetch;
    let createCalls = 0;
    let resolveCreate!: (response: Response) => void;
    const pendingCreate = new Promise<Response>((resolve) => {
      resolveCreate = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(request?.url ?? String(input), window.location.href);
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      if (method === "POST" && url.pathname === "/api/chats") {
        createCalls += 1;
        return pendingCreate;
      }
      return defaultFetch(input, init);
    }));

    render(
      <SelectedTicketContent
        bucket="story-1"
        projectId="project-1"
        moduleId="module-1"
        ticketKey="MEML-1"
        owner="studio"
        details={<div>Story details</div>}
        launchContext={{
          kind: "task",
          projectId: "project-1",
          moduleId: "module-1",
          taskId: "story-1",
          taskKey: "MEML-1",
          taskName: "Checkout story",
          ticketSeq: 1,
          profileReady: true,
          profile: null,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Codex · Chat" }));
    await waitFor(() => expect(createCalls).toBe(1));

    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    const pendingItem = await screen.findByRole("menuitem", {
      name: "Codex · Chat (starting…)",
    });
    expect(pendingItem).toBeDisabled();
    fireEvent.click(pendingItem);
    expect(createCalls).toBe(1);

    await act(async () => resolveCreate(json({ agent_run_id: "chat-1" }, 201)));
    expect(await screen.findByRole("tab", { name: "Codex Chat" })).toBeVisible();
    expect(createCalls).toBe(1);
  });

  it("reuses the durable create command after response loss and remount", async () => {
    const defaultFetch = globalThis.fetch;
    const commandIds: string[] = [];
    let createCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(request?.url ?? String(input), window.location.href);
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      if (method === "POST" && url.pathname === "/api/chats") {
        const rawBody = init?.body ?? (request ? await request.clone().text() : null);
        const body = JSON.parse(String(rawBody)) as Record<string, unknown>;
        commandIds.push(String(body.command_id));
        createCalls += 1;
        if (createCalls === 1) throw new TypeError("response lost");
        return json({ agent_run_id: "chat-1" }, 201);
      }
      return defaultFetch(input, init);
    }));

    const props = {
      bucket: "story-1",
      projectId: "project-1",
      moduleId: "module-1",
      ticketKey: "MEML-1",
      owner: "studio" as const,
      details: <div>Story details</div>,
      launchContext: {
        kind: "task" as const,
        projectId: "project-1",
        moduleId: "module-1",
        taskId: "story-1",
        taskKey: "MEML-1",
        taskName: "Checkout story",
        ticketSeq: 1,
        profileReady: true,
        profile: null,
      },
    };

    const first = render(<SelectedTicketContent {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Codex · Chat" }));
    await waitFor(() => expect(createCalls).toBe(1));
    expect(localStorage.getItem("ticketry.chat-pending-launches:v1"))
      .not.toContain("project-1");
    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    await screen.findByRole("menuitem", { name: "Codex · Chat" });
    first.unmount();

    render(<SelectedTicketContent {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Codex · Chat" }));
    expect(await screen.findByRole("tab", { name: "Codex Chat" })).toBeVisible();
    expect(createCalls).toBe(2);
    expect(commandIds).toHaveLength(2);
    expect(commandIds[0]).toBeTruthy();
    expect(commandIds[1]).toBe(commandIds[0]);
  });
});
