import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../app/StudioApp";
import { useTasksStore } from "../features/studio/stores/tasksStore";

const feed = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));

vi.mock("../features/agents/status/statusFeed", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/agents/status/statusFeed")>()),
  statusFeed: feed,
}));

vi.mock("../app/startup/BootstrapGate", () => ({
  BootstrapGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../app/shell/StudioLayout", () => ({ StudioLayout: () => null }));
vi.mock("../app/shell/StudioFooter", () => ({ StudioFooter: () => null }));
vi.mock("../app/navigation/useGlobalKeymap", () => ({ useGlobalKeymap: () => undefined }));
vi.mock("../app/shell/ticket-workspace/tasks/hooks/useTaskTree", () => ({
  useTaskTree: () => ({ rows: [] }),
}));

describe("Studio app agent status feed", () => {
  beforeEach(() => {
    feed.start.mockReset();
    feed.stop.mockReset();
    useTasksStore.setState({ selectedProjectId: null });
  });

  afterEach(() => {
    useTasksStore.setState({ selectedProjectId: null });
  });

  it("tracks the selected project and stops the previous feed", () => {
    const view = render(<App />);

    act(() => useTasksStore.setState({ selectedProjectId: "project-1" }));
    expect(feed.start).toHaveBeenLastCalledWith("project-1", {
      refreshSnapshotOnSocketOpen: true,
    });

    act(() => useTasksStore.setState({ selectedProjectId: "project-2" }));
    expect(feed.stop).toHaveBeenCalledTimes(1);
    expect(feed.start).toHaveBeenLastCalledWith("project-2", {
      refreshSnapshotOnSocketOpen: true,
    });

    view.unmount();
    expect(feed.stop).toHaveBeenCalledTimes(2);
  });
});
