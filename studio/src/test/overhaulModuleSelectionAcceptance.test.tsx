import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>(
    "../shared/api/client",
  );
  return {
    ...actual,
    getTasks: vi.fn(),
    putProfile: vi.fn(),
  };
});

vi.mock("../features/settings/profileTransport", async () => ({
  ...(await vi.importActual("../features/settings/profileTransport")),
  putProfile: vi.fn(),
}));

vi.mock("../features/work-items/queries/readTransport", async () => ({
  ...(await vi.importActual("../features/work-items/queries/readTransport")),
  readModuleTreeRecords: vi.fn(),
}));

import { ModalHost, useModalStore } from "../app/modal";
import { useStudioStore } from "../features/projects/store";
import {
  getConfigSnapshot,
  seedConfig,
} from "../features/studio/stores/configStore";
import { queryClient } from "../shared/query/queryClient";
import * as profileTransport from "../features/settings/profileTransport";
import * as workItemReadTransport from "../features/work-items/queries/readTransport";
import { useClientStore } from "../state/clientStore";

const getTasks = workItemReadTransport.readModuleTreeRecords as ReturnType<typeof vi.fn>;
const putProfile = profileTransport.putProfile as ReturnType<typeof vi.fn>;

function seedActiveProfile(): void {
  seedConfig({
    recentProfileIndex: 0,
    profiles: [
      {
        name: "Local",
        workspace_slug: "meml",
        agent_prompt: null,
        agent_prompts: {},
        module_links: [
          { module_id: "module-current", path: "/repos/current" },
        ],
        recent_project_id: "project-1",
        recent_module_ids: { "project-1": "module-current" },
      },
    ],
  });
}

describe("module-folder selection acceptance", () => {
  beforeEach(() => {
    queryClient.clear();
    getTasks.mockReset().mockResolvedValue({
      rootIds: [],
      children: {},
      order: [],
      states: [],
      workItems: [],
    });
    putProfile.mockReset().mockImplementation(async (_index, profile) => ({
      recent_profile_index: 0,
      features: getConfigSnapshot().features,
      profiles: [profile],
    }));
    seedActiveProfile();
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useClientStore.setState({
      selectedModuleId: "module-current",
      selectedTaskId: "task-current",
    });
    useModalStore.setState({ modalStack: [] });
  });

  it("preserves the current module when the pathless-module prompt is cancelled", async () => {
    seedConfig((state) => ({
      recentProfileIndex: 1,
      profiles: [
        {
          ...state.profiles[0],
          module_links: [
            ...state.profiles[0].module_links,
            { module_id: "module-new", path: "/repos/inactive" },
          ],
        },
        { ...state.profiles[0], name: "Active" },
      ],
    }));
    await useClientStore.getState().selectModule("module-new");

    expect(useClientStore.getState().selectedModuleId).toBe("module-current");
    expect(getTasks).not.toHaveBeenCalled();
    expect(useModalStore.getState().modalStack).toEqual([
      {
        type: "module-folder",
        payload: {
          moduleId: "module-new",
          resumeModuleSelection: true,
        },
      },
    ]);

    render(<ModalHost />);
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(useClientStore.getState().selectedModuleId).toBe("module-current");
    expect(useClientStore.getState().selectedTaskId).toBe("task-current");
  });

  it("preserves the current module when the folder link cannot be saved", async () => {
    putProfile.mockRejectedValueOnce(new Error("save failed"));
    await useClientStore.getState().selectModule("module-new");
    render(<ModalHost />);
    await act(async () => {
      await vi.dynamicImportSettled();
    });

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "/repos/new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("Could not save the module folder");
    expect(useClientStore.getState().selectedModuleId).toBe("module-current");
    expect(getTasks).not.toHaveBeenCalled();
  });

  it("resumes module selection only after the active profile link is saved", async () => {
    await useClientStore.getState().selectModule("module-new");
    render(<ModalHost />);
    await act(async () => {
      await vi.dynamicImportSettled();
    });

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "/repos/new" },
    });
    expect(useClientStore.getState().selectedModuleId).toBe("module-current");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(useClientStore.getState().selectedModuleId).toBe("module-new");
    });
    expect(putProfile).toHaveBeenCalledWith(
      0,
      expect.objectContaining({
        module_links: [
          { module_id: "module-current", path: "/repos/current" },
          { module_id: "module-new", path: "/repos/new" },
        ],
      }),
    );
    expect(getTasks).toHaveBeenCalledWith("project-1", "module-new");
  });
});
