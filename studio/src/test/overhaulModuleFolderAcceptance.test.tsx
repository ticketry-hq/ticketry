import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleFolder } from "../features/agents/terminal/ModuleFolder";
import {
  getConfigSnapshot,
  seedConfig,
} from "../features/studio/stores/configStore";
import { useModalStore } from "../app/modal";
import * as studioApi from "../shared/api/client";

const { selectModule } = vi.hoisted(() => ({
  selectModule: vi.fn(),
}));

vi.mock("../state/clientStore", () => ({
  useClientStore: {
    getState: () => ({ selectModule }),
  },
}));

describe("module-folder selection acceptance", () => {
  beforeEach(() => {
    selectModule.mockReset();
    selectModule.mockResolvedValue(undefined);
    seedConfig({
      profiles: [
        {
          name: "local",
          workspace_slug: "meml",
          agent_prompt: null,
          agent_prompts: {},
          module_links: [],
          recent_project_id: null,
        },
      ],
      recentProfileIndex: 0,
    });
    useModalStore.setState({
      modalStack: [
        {
          type: "module-folder",
          payload: { moduleId: "module-1", resumeModuleSelection: true },
        },
      ],
    });
  });

  it("rejects blank folders, then trims the saved path before resuming selection", async () => {
    const putProfile = vi.spyOn(studioApi, "putProfile").mockResolvedValue({
      recent_profile_index: 0,
      features: getConfigSnapshot().features,
      profiles: getConfigSnapshot().profiles,
    });
    render(
      <ModuleFolder
        payload={{ moduleId: "module-1", resumeModuleSelection: true }}
      />,
    );

    const input = screen.getByRole("textbox");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(save).toBeDisabled();
    expect(putProfile).not.toHaveBeenCalled();
    expect(selectModule).not.toHaveBeenCalled();
    expect(useModalStore.getState().modalStack).toHaveLength(1);

    fireEvent.change(input, { target: { value: "  /repos/ticketry  " } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await act(async () => {
      await Promise.resolve();
    });

    expect(putProfile.mock.calls[0][1].module_links).toEqual([
      { module_id: "module-1", path: "/repos/ticketry" },
    ]);
    expect(selectModule).toHaveBeenCalledWith("module-1");
    expect(useModalStore.getState().modalStack).toEqual([]);
  });
});
