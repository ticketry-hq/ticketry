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

function ChangesToolbarKeymap() {
  useGlobalKeymap();
  return (
    <div role="toolbar" data-changes-navigation>
      <button type="button">Push</button>
      <div
        role="dialog"
        onKeyDown={(event) => {
          if (event.key === "Escape") event.stopPropagation();
        }}
      >
        <button type="button">Cancel</button>
      </div>
    </div>
  );
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

  it("leaves Changes on Escape from a toolbar control while popups keep their Escape", () => {
    const { getByRole } = render(<ChangesToolbarKeymap />);
    act(() => openModuleChangesWorkspace("module-1"));

    fireEvent.keyDown(getByRole("button", { name: "Cancel" }), { key: "Escape" });
    expect(useChangesWorkspace.getState().active).toBe(true);

    fireEvent.keyDown(getByRole("button", { name: "Push" }), { key: "Escape" });
    expect(useChangesWorkspace.getState().active).toBe(false);
  });
});
