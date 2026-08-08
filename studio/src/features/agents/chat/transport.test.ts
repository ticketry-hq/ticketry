import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { unresolvedChatMessageSend } from "./eventSemantics";
import { useChatStore } from "./store";
import {
  acquireChatConnection,
  ChatDeliveryUnknownError,
  startChatTurn,
  stopChat,
} from "./transport";

vi.mock("./api", async (importOriginal) => ({
  ...await importOriginal<typeof import("./api")>(),
  getChatSnapshot: vi.fn(),
  sendChatTurn: vi.fn(),
  stopChatRun: vi.fn(),
}));

class OpenWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: OpenWebSocket[] = [];

  readonly sent: string[] = [];
  readyState = OpenWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(readonly url: string) {
    OpenWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = OpenWebSocket.OPEN;
    this.onopen?.(new Event("open"));
    this.onmessage?.({
      data: JSON.stringify({
        v: 1,
        type: "ready",
        agent_run_id: "chat-stop",
        cursor: 0,
      }),
    } as MessageEvent<string>);
  }

  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent<string>);
  }

  send(data: string): void {
    this.sent.push(String(data));
  }

  close(): void {
    this.readyState = OpenWebSocket.CLOSED;
    this.onclose?.(new Event("close") as CloseEvent);
  }
}

describe("Chat transport", () => {
  beforeEach(() => {
    localStorage.clear();
    OpenWebSocket.instances = [];
    useChatStore.getState().reset();
    useChatStore.getState().openSession({
      agent_run_id: "chat-stop",
      project_id: "project-1",
      module_id: "module-1",
      task_id: "task-1",
      agent: "codex",
      run_status: "running",
      status: "ready",
      active_turn_id: null,
      started_at: "2026-08-08T12:00:00Z",
      ended_at: null,
      updated_at: "2026-08-08T12:00:00Z",
      last_error: null,
      last_sequence: 0,
    });
    vi.stubGlobal("WebSocket", OpenWebSocket);
    vi.mocked(api.stopChatRun).mockReset().mockResolvedValue({
      agent_run_id: "chat-stop",
      stopped: true,
    });
    vi.mocked(api.getChatSnapshot).mockReset().mockRejectedValue(
      new TypeError("replay unavailable"),
    );
    vi.mocked(api.sendChatTurn).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the independent REST stop path even when the socket is ready", async () => {
    const release = acquireChatConnection("chat-stop");
    const socket = OpenWebSocket.instances[0]!;
    socket.open();
    expect(useChatStore.getState().sessions["chat-stop"]?.connection).toBe("ready");

    await stopChat("chat-stop");

    expect(api.stopChatRun).toHaveBeenCalledOnce();
    expect(api.stopChatRun).toHaveBeenCalledWith("chat-stop");
    expect(socket.sent.map((frame) => JSON.parse(frame))).not.toContainEqual(
      expect.objectContaining({ type: "stop" }),
    );
    expect(useChatStore.getState().sessions["chat-stop"]?.status).toBe("stopped");
    release();
  });

  it("fails closed when a socket error cannot be reconciled by replay", async () => {
    const release = acquireChatConnection("chat-stop");
    const socket = OpenWebSocket.instances[0]!;
    socket.open();

    const submitted = startChatTurn("chat-stop", "Do this exactly once.");
    const command = JSON.parse(socket.sent[0]!) as Record<string, unknown>;
    socket.receive({
      v: 1,
      type: "error",
      agent_run_id: "chat-stop",
      command_id: command.command_id,
      code: "command_failed",
      message: "Provider response was lost",
      retryable: true,
    });

    await expect(submitted).rejects.toBeInstanceOf(ChatDeliveryUnknownError);
    expect(useChatStore.getState().sessions["chat-stop"]?.pending_user_messages)
      .toContainEqual(expect.objectContaining({
        id: command.command_id,
        text: "Do this exactly once.",
        delivery: "unknown",
      }));
    release();
  });

  it("fails closed when a REST error cannot be reconciled by replay", async () => {
    vi.mocked(api.sendChatTurn).mockRejectedValue(
      new api.ChatApiError(409, "turn/start failed", {
        code: "turn_start_failed",
      }),
    );

    await expect(startChatTurn("chat-stop", "Do this once over REST."))
      .rejects.toBeInstanceOf(ChatDeliveryUnknownError);
    expect(useChatStore.getState().sessions["chat-stop"]?.pending_user_messages)
      .toContainEqual(expect.objectContaining({
        text: "Do this once over REST.",
        delivery: "unknown",
      }));
  });

  it("fails closed when replay contains only the pre-dispatch message audit", async () => {
    const release = acquireChatConnection("chat-stop");
    const socket = OpenWebSocket.instances[0]!;
    socket.open();

    const submitted = startChatTurn("chat-stop", "Audit this delivery once.");
    const command = JSON.parse(socket.sent[0]!) as Record<string, unknown>;
    const current = useChatStore.getState().sessions["chat-stop"]!;
    vi.mocked(api.getChatSnapshot).mockResolvedValue({
      run: {
        agent_run_id: current.agent_run_id,
        project_id: current.project_id,
        module_id: current.module_id,
        task_id: current.task_id,
        agent: current.agent,
        run_status: "running",
        status: "ready",
        active_turn_id: null,
        started_at: current.started_at,
        ended_at: null,
        updated_at: "2026-08-08T12:00:01Z",
        last_error: null,
        last_sequence: 1,
      },
      session: {
        status: "ready",
        active_turn_id: null,
        last_error: null,
        next_sequence: 2,
        updated_at: "2026-08-08T12:00:01Z",
      },
      events: [{
        sequence: 1,
        event_type: "thread.message-sent",
        payload: {
          id: command.command_id,
          command_id: command.command_id,
          text: "Audit this delivery once.",
          deliveryState: "pending",
        },
        created_at: "2026-08-08T12:00:01Z",
      }],
      cursor: 1,
    });
    socket.receive({
      v: 1,
      type: "error",
      agent_run_id: "chat-stop",
      command_id: command.command_id,
      code: "command_failed",
      message: "Provider outcome unavailable",
      retryable: true,
    });

    await expect(submitted).rejects.toBeInstanceOf(ChatDeliveryUnknownError);
    const afterReplay = useChatStore.getState().sessions["chat-stop"]!;
    expect(afterReplay.pending_user_messages).toEqual([]);
    expect(unresolvedChatMessageSend(afterReplay.events)).toMatchObject({
      id: command.command_id,
      text: "Audit this delivery once.",
    });
    release();
  });
});
