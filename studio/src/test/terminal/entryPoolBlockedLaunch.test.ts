import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  disposeAll,
  ensureConnected,
  syncEntries,
} from "../../features/agents/terminal/internal/entryPool";
import {
  useTerminalStore,
  type SessionMeta,
} from "../../features/agents/terminal";
import { ApiError } from "../../features/agents/api/agentApi";
import type { TerminalClientEvent } from "../../features/agents/terminal/internal/terminalClient";

// ADR-0015 — a launch bound to a deactivated provider is blocked, not
// substituted. The refusal reaches the terminal as a policy code, and this is
// where the user finds out why: the surface must name the cause and the fix,
// not report `HTTP 400`.

const H = vi.hoisted(() => ({
  writes: [] as string[],
  createTerminalRun: vi.fn(),
  cbs: null as ((event: TerminalClientEvent) => void) | null,
}));

vi.mock("../../features/agents/api/agentApi", async () => {
  const actual = await vi.importActual<
    typeof import("../../features/agents/api/agentApi")
  >("../../features/agents/api/agentApi");
  return { ...actual, createTerminalRun: H.createTerminalRun };
});

vi.mock("xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon(a: { activate?: (t: unknown) => void }) {
      a.activate?.(this);
    }
    attachCustomKeyEventHandler() {}
    open() {}
    onData() {
      return { dispose() {} };
    }
    onRender() {
      return { dispose() {} };
    }
    write(chunk: string) {
      H.writes.push(chunk);
    }
    dispose() {}
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    activate() {}
    fit() {}
    dispose() {}
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    activate() {}
    dispose() {}
  },
}));

vi.mock(
  "../../features/agents/terminal/internal/terminalClientRuntime",
  () => ({
    terminalClientTransport: {
      attach: (_params: unknown, cbs: (event: TerminalClientEvent) => void) => {
        H.cbs = cbs;
        return {
          input: vi.fn(),
          resize: vi.fn(),
          scroll: vi.fn(),
          detach: vi.fn(),
          suspend: () => false,
          resume: vi.fn(),
          status: () => "ready",
        };
      },
    },
  }),
);

const baseMeta: SessionMeta = {
  sessionId: "sess-1",
  taskId: "task-1",
  projectId: "proj-1",
  moduleId: "mod-1",
  agent: "gemini",
  ticketSeq: 1,
  status: "connecting",
  isPlanning: false,
  isInstant: false,
  initialPrompt: null,
  agentRunId: null,
  isDocChat: false,
  docRelPath: null,
  docId: null,
};

function seedAndConnect() {
  const meta = { ...baseMeta };
  useTerminalStore.setState({ sessions: { "sess-1": meta }, resumableSessions: {} });
  syncEntries({ "sess-1": meta });
  ensureConnected("sess-1", meta);
}

beforeEach(() => {
  H.writes = [];
  H.createTerminalRun.mockReset();
  useTerminalStore.setState({
    sessions: {},
    persistedSessions: {},
    resumableSessions: {},
  });
});

afterEach(() => {
  disposeAll();
});

describe("blocked launch reason at the terminal surface", () => {
  it("names the deactivated provider block instead of a generic HTTP failure", async () => {
    H.createTerminalRun.mockRejectedValue(
      new ApiError(400, "HTTP 400", { detail: { error: "provider_not_activated" } }),
    );
    seedAndConnect();

    await vi.waitFor(() => {
      expect(useTerminalStore.getState().sessions["sess-1"].status).toBe("error");
    });
    const written = H.writes.join("");
    expect(written).toContain("deactivated");
    expect(written).toContain("Settings → Model configuration");
    expect(written).not.toContain("HTTP 400");
  });

  it("leaves an unrelated launch failure reported as it arrives", async () => {
    H.createTerminalRun.mockRejectedValue(
      new ApiError(400, "HTTP 400", { detail: { error: "no_profile_selected" } }),
    );
    seedAndConnect();

    await vi.waitFor(() => {
      expect(useTerminalStore.getState().sessions["sess-1"].status).toBe("error");
    });
    expect(H.writes.join("")).toContain("no_profile_selected");
  });
});
