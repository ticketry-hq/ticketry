import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { ModuleFolder } from "../features/agents/terminal/ModuleFolder";
import { ModalHost } from "../app/modal";
import { getConfigSnapshot, seedConfig } from "../features/studio/stores/configStore";
import { useModalStore } from "../app/modal";
import * as documentRegistry from "../features/documents/documentRegistry";
import * as studioApi from "../shared/api/client";
import type { StudioRuntime } from "../runtime";

function folderPickerRuntime(
  pickFolder: () => Promise<string | null>,
): StudioRuntime {
  return {
    platform: "desktop",
    capabilities: {
      statusFeed: true,
      websocketTerminal: true,
      nativeLifecycle: false,
      serviceSupervision: true,
      nativeTerminal: false,
      nativeFolderPicker: true,
    },
    readWorkTracker: (routes) => routes.graphQl(async () => {
      throw new Error("GraphQL is not used by this test.");
    }),
    writeWorkTracker: (routes) => routes.graphQl(async () => {
      throw new Error("GraphQL is not used by this test.");
    }),
    readSettings: (routes) => routes.graphQl(async () => {
      throw new Error("GraphQL is not used by this test.");
    }),
    writeSettings: (routes) => routes.graphQl(async () => {
      throw new Error("GraphQL is not used by this test.");
    }),
    statusStream: () => null,
    documentUrl: (documentId: string, relPath: string) =>
      `/api/docs/${documentId}/${relPath}`,
    pickFolder,
    retryServices: async () => {},
    startup: () => ({
      endpoints: {
        workTrackerApi: "/api/work-tracker",
        agentApi: "/api",
        statusApi: "/api",
        terminalWebSocket: "/ws/terminal",
      },
      values: { workTrackerApiKey: "" },
      serviceHealth: {
        state: "ready",
        service: "backend",
        message: null,
        logPointer: null,
      },
      initialNotices: [],
    }),
    subscribeServiceHealth: () => () => {},
    subscribeUserNotices: () => () => {},
  };
}

describe("ModuleFolder modal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    seedConfig({
      profiles: [
        {
          name: "p",
          workspace_slug: "ws",
          agent_prompt: null,
          agent_prompts: {},
          module_links: [],
          recent_project_id: null,
        },
      ],
      recentProfileIndex: 0,
    });
        useModalStore.setState({ modalStack: [{ type: "module-folder" }] });
  });

  it("shows unique non-empty recent folders newest first", () => {
    seedConfig({
      profiles: [
        {
          name: "p",
          workspace_slug: "ws",
          agent_prompt: null,
          agent_prompts: {},
          module_links: [
            { module_id: "mod-1", path: "/repos/old" },
            { module_id: "mod-2", path: "" },
            { module_id: "mod-3", path: "/repos/shared" },
            { module_id: "mod-4", path: "/repos/old" },
            { module_id: "mod-5", path: "relative-folder" },
          ],
          recent_project_id: null,
        },
      ],
      recentProfileIndex: 0,
    });

    render(<ModuleFolder payload={{ moduleId: "mod-new" }} />);

    const recentFolders = screen.getByRole("list", {
      name: "Recent folders",
    });
    expect(
      within(recentFolders)
        .getAllByRole("listitem")
        .map((option) => option.textContent),
    ).toEqual(["/repos/old", "/repos/shared"]);
  });

  it("drafts a desktop-picked folder without persisting it", async () => {
    const pickFolder = vi.fn().mockResolvedValue("/repos/picked");
    const putSpy = vi.spyOn(studioApi, "putProfile");

    render(
      <ModuleFolder
        payload={{ moduleId: "mod-new" }}
        runtime={folderPickerRuntime(pickFolder)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pick Folder" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(pickFolder).toHaveBeenCalledOnce();
    expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe(
      "/repos/picked",
    );
    expect(putSpy).not.toHaveBeenCalled();
  });

  it("saves a picked folder through the profile flow and preserves modal follow-up chaining", async () => {
    const pickFolder = vi.fn().mockResolvedValue("/repos/picked");
    const putSpy = vi.spyOn(studioApi, "putProfile").mockResolvedValue({
      recent_profile_index: 0,
      features: getConfigSnapshot().features,
      profiles: getConfigSnapshot().profiles,
    });
    useModalStore.setState({
      modalStack: [
        {
          type: "module-folder",
          payload: { moduleId: "mod-new", next: "agent-picker" },
        },
      ],
    });

    render(
      <ModuleFolder
        payload={{ moduleId: "mod-new", next: "agent-picker" }}
        runtime={folderPickerRuntime(pickFolder)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pick Folder" }));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(putSpy.mock.calls[0][1].module_links).toEqual([
      { module_id: "mod-new", path: "/repos/picked" },
    ]);
    expect(useModalStore.getState().modalStack).toEqual([
      { type: "agent-picker", payload: undefined },
    ]);
  });

  it("shows Pick Folder after recents and leaves the draft unchanged on picker cancellation", async () => {
    seedConfig((state) => ({
      profiles: [
        {
          ...state.profiles[0],
          module_links: [{ module_id: "mod-1", path: "/repos/recent" }],
        },
      ],
    }));
    const pickFolder = vi.fn().mockResolvedValue(null);
    const putSpy = vi.spyOn(studioApi, "putProfile");

    render(
      <ModuleFolder
        payload={{ moduleId: "mod-new" }}
        runtime={folderPickerRuntime(pickFolder)}
      />,
    );
    const recentFolders = screen.getByRole("list", { name: "Recent folders" });
    const pickButton = screen.getByRole("button", { name: "Pick Folder" });
    expect(
      recentFolders.compareDocumentPosition(pickButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "/repos/manual-draft" },
    });
    fireEvent.click(pickButton);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe(
      "/repos/manual-draft",
    );
    expect(putSpy).not.toHaveBeenCalled();
    expect(getConfigSnapshot().profiles[0].module_links).toEqual([
      { module_id: "mod-1", path: "/repos/recent" },
    ]);
  });

  it("keeps the native folder action out of browser Studio", () => {
    render(<ModuleFolder payload={{ moduleId: "mod-new" }} />);

    expect(
      screen.queryByRole("button", { name: "Pick Folder" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("does not request or render filesystem suggestions", async () => {
    // Arrange an available filesystem completion.

    seedConfig((state) => ({
      profiles: [
        {
          ...state.profiles[0],
          module_links: [{ module_id: "mod-1", path: "/repos/recent" }],
        },
      ],
    }));
    const completeSpy = vi.spyOn(documentRegistry, "completeDirectories").mockResolvedValue([
      "/repos/suggested",
    ]);

    // Type a path and pass the old debounce window.

    render(<ModuleFolder payload={{ moduleId: "mod-2" }} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "/repos/s" },
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    // Keep filesystem autocomplete absent.

    expect(completeSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("suggestions")).not.toBeInTheDocument();
  });

  it("fills a recent folder before Save persists it for the current module", async () => {
    seedConfig((state) => ({
      profiles: [
        {
          ...state.profiles[0],
          module_links: [{ module_id: "mod-1", path: "/repos/one" }],
        },
      ],
    }));
    const putSpy = vi.spyOn(studioApi, "putProfile").mockResolvedValue({
      recent_profile_index: 0,
      features: getConfigSnapshot().features,
      profiles: getConfigSnapshot().profiles,
    });

    render(<ModuleFolder payload={{ moduleId: "mod-2" }} />);
    fireEvent.click(screen.getByText("/repos/one"));

    expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe(
      "/repos/one",
    );
    expect(putSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(putSpy.mock.calls[0][1].module_links).toEqual([
      { module_id: "mod-1", path: "/repos/one" },
      { module_id: "mod-2", path: "/repos/one" },
    ]);
  });

  it("selects then saves a recent folder with ArrowDown and Enter", async () => {
    seedConfig((state) => ({
      profiles: [
        {
          ...state.profiles[0],
          module_links: [
            { module_id: "mod-1", path: "/repos/older" },
            { module_id: "mod-2", path: "/repos/newer" },
          ],
        },
      ],
    }));
    const putSpy = vi.spyOn(studioApi, "putProfile").mockResolvedValue({
      recent_profile_index: 0,
      features: getConfigSnapshot().features,
      profiles: getConfigSnapshot().profiles,
    });

    render(<ModuleFolder payload={{ moduleId: "mod-3" }} />);
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe(
      "/repos/newer",
    );
    expect(putSpy).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => {
      await Promise.resolve();
    });

    expect(putSpy.mock.calls[0][1].module_links).toEqual([
      { module_id: "mod-1", path: "/repos/older" },
      { module_id: "mod-2", path: "/repos/newer" },
      { module_id: "mod-3", path: "/repos/newer" },
    ]);
  });

  it("shows recent folders from only the active profile", () => {
    const firstProfile = getConfigSnapshot().profiles[0];
    seedConfig({
      profiles: [
        {
          ...firstProfile,
          name: "inactive",
          module_links: [{ module_id: "mod-1", path: "/repos/inactive" }],
        },
        {
          ...firstProfile,
          name: "active",
          module_links: [{ module_id: "mod-2", path: "/repos/active" }],
        },
      ],
      recentProfileIndex: 1,
    });

    render(<ModuleFolder payload={{ moduleId: "mod-3" }} />);

    expect(screen.getByText("/repos/active")).toBeInTheDocument();
    expect(screen.queryByText("/repos/inactive")).not.toBeInTheDocument();
  });

  it("discards a recent folder selection on Cancel", () => {
    seedConfig((state) => ({
      profiles: [
        {
          ...state.profiles[0],
          module_links: [{ module_id: "mod-1", path: "/repos/one" }],
        },
      ],
    }));
    const putSpy = vi.spyOn(studioApi, "putProfile");

    render(<ModuleFolder payload={{ moduleId: "mod-2" }} />);
    fireEvent.click(screen.getByText("/repos/one"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(putSpy).not.toHaveBeenCalled();
    expect(getConfigSnapshot().profiles[0].module_links).toEqual([
      { module_id: "mod-1", path: "/repos/one" },
    ]);
  });

  it("discards a native folder selection on Cancel", async () => {
    const pickFolder = vi.fn().mockResolvedValue("/repos/picked");
    const putSpy = vi.spyOn(studioApi, "putProfile");

    render(
      <ModuleFolder
        payload={{ moduleId: "mod-new" }}
        runtime={folderPickerRuntime(pickFolder)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pick Folder" }));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(putSpy).not.toHaveBeenCalled();
    expect(getConfigSnapshot().profiles[0].module_links).toEqual([]);
    expect(useModalStore.getState().modalStack).toEqual([]);
  });

  it("Enter on unchanged value calls api.putProfile with module_links updated", async () => {
    const putSpy = vi.spyOn(studioApi, "putProfile").mockResolvedValue({
      recent_profile_index: 0,
      features: getConfigSnapshot().features,
      profiles: [
        {
          name: "p",
          workspace_slug: "ws",
          agent_prompt: null,
          agent_prompts: {},
          module_links: [{ module_id: "mod-1", path: "/usr/local" }],
          recent_project_id: null,
        },
      ],
    });
    render(<ModuleFolder payload={{ moduleId: "mod-1" }} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/usr/local" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // Let pending microtasks flush.
    await act(async () => {
      await Promise.resolve();
    });
    expect(putSpy).toHaveBeenCalledTimes(1);
    const [, body] = putSpy.mock.calls[0];
    expect(body.module_links).toEqual([
      { module_id: "mod-1", path: "/usr/local" },
    ]);
  });

  it("Studio host reads and saves the restarted Studio profile store", async () => {
    seedConfig({ profiles: [], recentProfileIndex: null });
    seedConfig({
      profiles: [
        {
          name: "studio",
          workspace_slug: "ws",
          agent_prompt: null,
          agent_prompts: {},
          module_links: [{ module_id: "mod-1", path: "/studio/repo" }],
          recent_project_id: null,
        },
      ],
      recentProfileIndex: 0,
    });
    useModalStore.setState({
      modalStack: [{ type: "module-folder", payload: { moduleId: "mod-1" } }],
    });
    const putSpy = vi.spyOn(studioApi, "putProfile").mockResolvedValue({
      recent_profile_index: 0,
      features: getConfigSnapshot().features,
      profiles: getConfigSnapshot().profiles,
    });

    render(<ModalHost />);
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("/studio/repo");
    fireEvent.change(input, { target: { value: "/studio/new" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => {
      await Promise.resolve();
    });

    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy.mock.calls[0][1].module_links).toEqual([
      { module_id: "mod-1", path: "/studio/new" },
    ]);
  });
});
