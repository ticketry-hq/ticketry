import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import {
  dismissChangesWorkspace,
  openModuleChangesWorkspace,
  useChangesWorkspace,
} from "../features/agents/worktrees";

function Keymap() {
  useGlobalKeymap();
  return <input aria-label="typing" />;
}

describe("overhaul acceptance - Escape leaves Changes", () => {
  afterEach(() => act(() => dismissChangesWorkspace()));

  it("closes the Changes workspace on a bare Escape but not while typing", () => {
    const { getByLabelText } = render(<Keymap />);
    act(() => openModuleChangesWorkspace("module-1"));
    expect(useChangesWorkspace.getState().active).toBe(true);

    fireEvent.keyDown(getByLabelText("typing"), { key: "Escape" });
    expect(useChangesWorkspace.getState().active).toBe(true);

    fireEvent.keyDown(document.body, { key: "Escape", shiftKey: true });
    expect(useChangesWorkspace.getState().active).toBe(true);

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(useChangesWorkspace.getState().active).toBe(false);
  });
});
