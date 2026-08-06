import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useModalStore } from "../app/modal";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import {
  studioKeymapRegistry,
  type BindingOverride,
} from "../app/navigation/keymapRegistry";
import { loadKeybindingOverrides } from "../app/navigation/keymapSettings";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useClientStore } from "../state/clientStore";

const settingsOverride: BindingOverride = {
  context: "global",
  actionId: "settings",
  chord: {
    key: "k",
    alt: false,
    control: true,
    meta: false,
    shift: false,
  },
};

function KeymapHarness() {
  useGlobalKeymap([]);
  return null;
}

describe("persisted binding overrides", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    studioKeymapRegistry.setOverrides([]);
    useModalStore.setState({ modalStack: [], activeBindings: null });
    useClientStore.setState({ focusedPane: "tasks" });
    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedModuleId: "module-1",
      selectedTaskId: null,
    });
  });

  it("applies a replacement live and removes the default chord", () => {
    render(<KeymapHarness />);

    act(() => studioKeymapRegistry.setOverrides([settingsOverride]));

    expect(
      studioKeymapRegistry.getEffectiveBinding("global", "settings"),
    ).toEqual(settingsOverride);
    fireEvent.keyDown(window, { key: "e" });
    expect(useModalStore.getState().modalStack).toEqual([]);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(useModalStore.getState().modalStack).toEqual([{ type: "settings" }]);
  });

  it("loads persisted overrides and falls back to working defaults on failure", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: [settingsOverride] }), {
          status: 200,
        }),
      )
      .mockRejectedValueOnce(new TypeError("backend unavailable"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await loadKeybindingOverrides();
    expect(studioKeymapRegistry.getOverrides()).toEqual([settingsOverride]);

    await expect(loadKeybindingOverrides()).resolves.toBeUndefined();
    expect(studioKeymapRegistry.getOverrides()).toEqual([]);

    render(<KeymapHarness />);
    fireEvent.keyDown(window, { key: "e" });
    expect(useModalStore.getState().modalStack).toEqual([{ type: "settings" }]);
  });
});
