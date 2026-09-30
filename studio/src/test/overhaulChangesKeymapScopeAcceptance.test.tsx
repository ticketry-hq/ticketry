import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { studioKeymapRegistry } from "../app/navigation/keymapRegistry";
import { KeyboardShortcutsPanel } from "../features/studio/modals/KeyboardShortcutsModal";

const LOCAL_CHANGES_ACTIONS = [
  "changes.checkout.previous",
  "changes.checkout.next",
  "changes.checkout.first",
  "changes.checkout.last",
  "changes.checkout.select",
  "changes.checkout.cancel",
  "changes.file.previous",
  "changes.file.next",
  "changes.file.first",
  "changes.file.last",
  "changes.file.activate",
  "changes.file.expand",
  "changes.file.collapse",
] as const;

describe("overhaul acceptance - Changes keymap scope", () => {
  it("[overhaul-356] keeps local Changes keys out of planning capture and labels them in shortcut help", () => {
    for (const key of ["Home", "End", "Escape", " "]) {
      expect(
        studioKeymapRegistry.resolve("capture", new KeyboardEvent("keydown", { key })),
      ).toBeNull();
    }

    render(<KeyboardShortcutsPanel />);
    const table = screen.getByRole("table", {
      name: "Effective keyboard bindings by action and Keymap context",
    });

    for (const actionId of LOCAL_CHANGES_ACTIONS) {
      expect(within(table).queryByText(actionId)).toBeNull();
    }
    expect(within(table).getByText("Previous checkout")).toBeVisible();
    expect(within(table).getAllByText("Changes")).not.toHaveLength(0);
  });
});
