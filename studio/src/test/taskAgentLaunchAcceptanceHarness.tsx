import type { ReactNode } from "react";
import { beforeEach, vi } from "vitest";
import type { WorkspaceLauncherContext } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";

const terminalApi = vi.hoisted(() => ({
  createTerminalRun: vi.fn(),
  getDocuments: vi.fn(),
}));

const terminalTransport = vi.hoisted(() => ({ attach: vi.fn() }));

const providerApi = vi.hoisted(() => ({
  getProviderCatalog: vi.fn(),
  getLaunchProviderCapabilities: vi.fn(),
}));

vi.doMock("../features/agents/api/agentApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/agents/api/agentApi")>()),
  ...terminalApi,
}));

vi.doMock("../features/agents/terminal/internal/terminalClientRuntime", () => ({
  terminalClientTransport: terminalTransport,
}));

vi.doMock("./legacyApiFixture", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./legacyApiFixture")>()),
  ...providerApi,
}));

vi.doMock("../features/workflows/providerQueries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/workflows/providerQueries")>();
  const React = await import("react");
  return {
    ...actual,
    setProviderCapabilities: (capabilities: unknown[]) => {
      actual.setProviderCapabilities(capabilities as never);
      providerApi.getLaunchProviderCapabilities.mockResolvedValue(capabilities);
    },
    loadProviderCapabilities: providerApi.getLaunchProviderCapabilities,
    loadProviderCatalog: async () => (await providerApi.getProviderCatalog()).value,
    useProviderCapabilitiesQuery: () => {
      const initial = actual.getProviderCapabilitiesSnapshot();
      const [result, setResult] = React.useState<{
        data?: unknown[];
        isLoading: boolean;
        isError: boolean;
      }>(initial
        ? { data: initial, isLoading: false, isError: false }
        : { isLoading: true, isError: false });
      React.useEffect(() => {
        let active = true;
        providerApi.getLaunchProviderCapabilities().then(
          (data: unknown[]) => active && setResult({ data, isLoading: false, isError: false }),
          () => active && setResult({ isLoading: false, isError: true }),
        );
        return () => { active = false; };
      }, []);
      return result;
    },
  };
});

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
const { ModalHost } = await import("../app/modal/ModalHost");
const { useModalStore } = await import("../app/modal/modalStore");
const { useTerminalStore } = await import("../features/agents/terminal");
const { setProviderCapabilities } = await import(
  "../features/workflows/providerQueries"
);
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
  localStorage.setItem("ticketry:terminal-renderer", "xterm");
  setProviderCapabilities(defaultCapabilities);
  providerApi.getLaunchProviderCapabilities.mockResolvedValue(defaultCapabilities);
  providerApi.getProviderCatalog.mockResolvedValue({
    value: {
      activated_providers: ["codex"],
      global_default: null,
    },
  });
  useClientStore.setState({
    workspaces: {},
    activeByTask: {},
    sidebarVisible: true,
  });
  useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
  useModalStore.setState({ modalStack: [] });
  terminalApi.getDocuments.mockResolvedValue({ documents: [] });
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
  children?: ReactNode;
};

function workspaceView({
  launchContext,
  bucket = "task-570",
  projectId = "project-570",
  moduleId = "module-570",
  children,
}: WorkspaceViewOptions) {
  return (
    <>
      {children}
      <SelectedTicketContent
        bucket={bucket}
        projectId={projectId}
        moduleId={moduleId}
        owner="studio"
        details={<div>Task details</div>}
        launchContext={launchContext}
      />
      <ModalHost />
    </>
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
  setProviderCapabilities,
  terminalApi,
  terminalTransport,
  useTerminalStore,
  workspaceView,
};
export type { WorkspaceLauncherContext, WorkspaceViewOptions };
