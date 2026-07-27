import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BootstrapGate } from "../app/studio/BootstrapGate";

const mocks = vi.hoisted(() => ({
  studioLoadConfig: vi.fn(),
  agentLoadConfig: vi.fn(),
  hydratePanelLayout: vi.fn(),
  selectProfile: vi.fn(),
  selectProject: vi.fn(),
  getWorkspace: vi.fn(),
}));

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>(
    "../shared/api/client",
  );
  return { ...actual, getWorkspace: mocks.getWorkspace };
});

let profiles: Array<{ recent_project_id?: string | null }> = [];

vi.mock("../features/studio/stores/configStore", () => ({
  useConfigStore: {
    getState: () => ({
      loadConfig: mocks.studioLoadConfig,
      profiles,
      recentProfileIndex: null,
      selectProfile: mocks.selectProfile,
    }),
  },
}));

vi.mock("../features/agents/stores/configStore", () => ({
  useConfigStore: {
    getState: () => ({ loadConfig: mocks.agentLoadConfig }),
  },
}));

vi.mock("../features/studio/stores/tasksStore", () => ({
  useTasksStore: {
    getState: () => ({
      selectedProjectId: null,
      projects: [],
      selectProject: mocks.selectProject,
    }),
  },
}));

vi.mock("../features/studio/stores/uiStore", () => ({
  useUIStore: {
    getState: () => ({
      sidebarVisible: true,
      hydratePanelLayout: mocks.hydratePanelLayout,
      setSidebarVisible: vi.fn(),
      setFocusedPane: vi.fn(),
    }),
  },
  visiblePaneOrder: () => ["tasks"],
}));

describe("BootstrapGate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    profiles = [];
    mocks.studioLoadConfig.mockResolvedValue(undefined);
    mocks.agentLoadConfig.mockResolvedValue(undefined);
    mocks.hydratePanelLayout.mockResolvedValue(null);
    mocks.selectProfile.mockResolvedValue(undefined);
    mocks.selectProject.mockResolvedValue(undefined);
    mocks.getWorkspace.mockResolvedValue({
      id: "w1", name: "MEML", slug: "meml", onboarding_required: false,
    });
  });

  afterEach(() => vi.useRealTimers());

  it("reports an unavailable local server without surfacing the transport error", async () => {
    mocks.studioLoadConfig.mockRejectedValue(new TypeError("Failed to fetch"));

    render(
      <BootstrapGate>
        <div>Studio ready</div>
      </BootstrapGate>,
    );

    expect(
      await screen.findByText("The local server is not running."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Start the local server, then retry. Retrying…"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
  });

  it("keeps the provisioning message when the reachable backend has no profile", async () => {
    render(
      <BootstrapGate>
        <div>Studio ready</div>
      </BootstrapGate>,
    );

    expect(
      await screen.findByText("The local work tracker is still starting up. Retrying…"),
    ).toBeInTheDocument();
    expect(screen.queryByText("The local server is not running.")).not.toBeInTheDocument();
  });

  it("retries manually and returns to Studio after the server recovers", async () => {
    mocks.studioLoadConfig.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(
      <BootstrapGate>
        <div>Studio ready</div>
      </BootstrapGate>,
    );

    await screen.findByText("The local server is not running.");
    profiles = [{}];
    mocks.studioLoadConfig.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByText("Studio ready", {}, { timeout: 3_000 }),
    ).toBeInTheDocument();
  });

  it("reaches the app shell even when the workspace onboarding load rejects", async () => {
    // Regression lock: a workspace endpoint outage must not flip the
    // bootstrap outcome and strand an existing user on a retry screen.
    profiles = [{}];
    mocks.getWorkspace.mockRejectedValue(new TypeError("Failed to fetch"));

    render(
      <BootstrapGate>
        <div>Studio ready</div>
      </BootstrapGate>,
    );

    expect(await screen.findByText("Studio ready")).toBeInTheDocument();
  });

  it("continues automatically retrying while the server is unavailable", async () => {
    vi.useFakeTimers();
    mocks.studioLoadConfig.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(
      <BootstrapGate>
        <div>Studio ready</div>
      </BootstrapGate>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("The local server is not running.")).toBeInTheDocument();
    profiles = [{}];
    mocks.studioLoadConfig.mockResolvedValue(undefined);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(screen.getByText("Studio ready")).toBeInTheDocument();
  });
});
