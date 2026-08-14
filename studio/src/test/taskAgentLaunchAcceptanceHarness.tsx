import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, vi } from "vitest";
import type { WorkspaceLauncherContext } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";

const terminalApi = vi.hoisted(() => ({
  createTerminalRun: vi.fn(),
  getDocuments: vi.fn(),
  getTerminals: vi.fn(),
  listResumableTerminals: vi.fn(),
}));

const terminalTransport = vi.hoisted(() => ({ attach: vi.fn() }));

const providerApi = vi.hoisted(() => ({
  getLaunchProviderCapabilities: vi.fn(),
}));

vi.doMock("../features/agents/api/agentApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/agents/api/agentApi")>()),
  ...terminalApi,
}));

vi.doMock("../features/agents/terminal/internal/terminalClientRuntime", () => ({
  terminalClientTransport: terminalTransport,
}));

vi.doMock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
  ...providerApi,
}));

vi.doMock("xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon() {}
    attachCustomKeyEventHandler() {}
    open() {}
    focus() {}
    write() {}
    onData() {
      return { dispose() {} };
    }
    dispose() {}
  },
}));

vi.doMock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
    proposeDimensions() {
      return { cols: 80, rows: 24 };
    }
  },
}));

vi.doMock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {},
}));

const { SelectedTicketContent } = await import(
  "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent"
);
const { useTerminalStore } = await import("../features/agents/terminal");
const { seedConfig } = await import("../features/studio/stores/configStore");
const { setProviderCapabilities } = await import(
  "../features/workflows/providerQueries"
);
const { queryClient } = await import("../shared/query/queryClient");
const { useClientStore } = await import("../state/clientStore");

class TestResizeObserver {
  observe() {}
  disconnect() {}
}

const defaultCapabilities = [
  {
    agent: "codex",
    accepts_model: true,
    accepts_any_model: false,
    model_aliases: [],
    model_prefixes: [],
    reasoning_levels: ["low", "medium", "high", "xhigh"],
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  setProviderCapabilities(defaultCapabilities);
  providerApi.getLaunchProviderCapabilities.mockResolvedValue(defaultCapabilities);
  seedConfig({ features: { sidebar: true, projects: true } });
  useClientStore.setState({
    workspaces: {},
    activeByTask: {},
    sidebarVisible: true,
  });
  useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
  terminalApi.getDocuments.mockResolvedValue({ documents: [] });
  terminalApi.getTerminals.mockResolvedValue([]);
  terminalApi.listResumableTerminals.mockResolvedValue([]);
  terminalApi.createTerminalRun.mockResolvedValue({ agent_run_id: "run-570" });
  terminalTransport.attach.mockImplementation((_params, onEvent) => {
    const handle = {
      input: vi.fn(),
      resize: vi.fn(),
      scroll: vi.fn(),
      detach: vi.fn(),
      status: vi.fn(() => "open"),
      resume: vi.fn(),
      suspend: vi.fn(),
    };
    queueMicrotask(() =>
      onEvent({
        type: "ready",
        sessionId: "terminal-570",
        agentRunId: "run-570",
      }),
    );
    return handle;
  });
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

type WorkspaceViewOptions = {
  launchContext: WorkspaceLauncherContext;
  bucket?: string;
  projectId?: string;
  moduleId?: string | null;
  ticketSeq?: number | null;
  children?: ReactNode;
};

function workspaceView({
  launchContext,
  bucket = "task-570",
  projectId = "project-570",
  moduleId = "module-570",
  ticketSeq = 570,
  children,
}: WorkspaceViewOptions) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <SelectedTicketContent
        bucket={bucket}
        projectId={projectId}
        moduleId={moduleId}
        ticketSeq={ticketSeq}
        owner="studio"
        details={<div>Task details</div>}
        launchContext={launchContext}
      />
    </QueryClientProvider>
  );
}

const providerCapability = (agent: string) => ({
  agent,
  accepts_model: true,
  accepts_any_model: false,
  model_aliases: [],
  model_prefixes: [],
  reasoning_levels: [],
});

export {
  providerApi,
  providerCapability,
  queryClient,
  setProviderCapabilities,
  terminalApi,
  terminalTransport,
  useTerminalStore,
  workspaceView,
};
export type { WorkspaceLauncherContext, WorkspaceViewOptions };
