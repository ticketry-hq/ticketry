import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BootstrapGate } from "../app/studio/BootstrapGate";

const mocks = vi.hoisted(() => ({
  studioLoadConfig: vi.fn(),
  agentLoadConfig: vi.fn(),
  hydratePanelLayout: vi.fn(),
  selectProfile: vi.fn(),
  selectProject: vi.fn(),
  createProject: vi.fn(),
  loadProjects: vi.fn(),
  setSidebarVisible: vi.fn(),
  setFocusedPane: vi.fn(),
  getWorkspace: vi.fn(),
}));

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>(
    "../shared/api/client",
  );
  return { ...actual, getWorkspace: mocks.getWorkspace };
});

let profiles: Array<{ recent_project_id?: string | null }> = [];
let features = { projects: true };
let projects: Array<{ id: string; identifier: string }> = [];
let selectedProjectId: string | null = null;

vi.mock("../features/studio/stores/configStore", () => ({
  useConfigStore: {
    getState: () => ({
      loadConfig: mocks.studioLoadConfig,
      profiles,
      features,
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
      selectedProjectId,
      projects,
      selectProject: mocks.selectProject,
      createProject: mocks.createProject,
      loadProjects: mocks.loadProjects,
    }),
  },
}));

vi.mock("../features/studio/stores/uiStore", () => ({
  useUIStore: {
    getState: () => ({
      sidebarVisible: true,
      hydratePanelLayout: mocks.hydratePanelLayout,
      setSidebarVisible: mocks.setSidebarVisible,
      setFocusedPane: mocks.setFocusedPane,
    }),
  },
  visiblePaneOrder: (
    sidebarVisible: boolean,
    hasSelectedProject: boolean,
    projectsEnabled: boolean,
  ) => {
    if (!sidebarVisible) return ["tasks", "details-or-terminal"];
    return [
      ...(projectsEnabled ? ["projects"] : []),
      ...(hasSelectedProject ? ["modules"] : []),
      "tasks",
      "details-or-terminal",
    ];
  },
}));

describe("BootstrapGate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    profiles = [];
    features = { projects: true };
    projects = [];
    selectedProjectId = null;
    mocks.studioLoadConfig.mockResolvedValue(undefined);
    mocks.agentLoadConfig.mockResolvedValue(undefined);
    mocks.hydratePanelLayout.mockResolvedValue(null);
    mocks.selectProfile.mockResolvedValue(undefined);
    mocks.selectProject.mockImplementation(async (id: string) => {
      selectedProjectId = id;
    });
    mocks.createProject.mockResolvedValue(undefined);
    mocks.loadProjects.mockResolvedValue(undefined);
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

  it("selects the resolved project and focuses Modules when Projects is off", async () => {
    profiles = [{ recent_project_id: "legacy-project" }];
    features = { projects: false };
    projects = [{ id: "coding-project", identifier: "CODING" }];

    render(
      <BootstrapGate>
        <div>Studio ready</div>
      </BootstrapGate>,
    );

    expect(await screen.findByText("Studio ready")).toBeInTheDocument();
    expect(mocks.selectProject).toHaveBeenCalledWith("coding-project");
    expect(mocks.setSidebarVisible).toHaveBeenCalledWith(true);
    expect(mocks.setFocusedPane).toHaveBeenLastCalledWith("modules");
  });

  it("resolves a missing CODING project through the existing project flow", async () => {
    profiles = [{}];
    features = { projects: false };
    mocks.createProject.mockResolvedValue({
      id: "created-coding-project",
      identifier: "CODING",
    });

    render(
      <BootstrapGate>
        <div>Studio ready</div>
      </BootstrapGate>,
    );

    expect(await screen.findByText("Studio ready")).toBeInTheDocument();
    expect(mocks.createProject).toHaveBeenCalledWith({
      name: "coding",
      slug: "CODING",
    });
    expect(mocks.selectProject).toHaveBeenCalledWith("created-coding-project");
  });

  it("preserves recent-project bootstrap behavior when Projects is on", async () => {
    profiles = [{ recent_project_id: "recent-project" }];
    features = { projects: true };
    projects = [
      { id: "coding-project", identifier: "CODING" },
      { id: "recent-project", identifier: "RECENT" },
    ];

    render(
      <BootstrapGate>
        <div>Studio ready</div>
      </BootstrapGate>,
    );

    expect(await screen.findByText("Studio ready")).toBeInTheDocument();
    expect(mocks.selectProject).toHaveBeenCalledWith("recent-project");
    expect(mocks.createProject).not.toHaveBeenCalled();
    expect(mocks.setSidebarVisible).not.toHaveBeenCalled();
    expect(mocks.setFocusedPane).toHaveBeenLastCalledWith("modules");
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
