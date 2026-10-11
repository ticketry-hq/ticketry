import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { studioKeymapRegistry } from "../app/navigation/keymapRegistry";
import { useModalStore } from "../app/modal/modalStore";
import { useClientStore } from "../state/clientStore";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";

it("[overhaul-617] honors effective shortcut overrides, caret and modal Escape precedence, group arrows and Enter", async () => {
  const boundary = storySprintModuleBoundary();
  boundary.mount({ shell: true, selectedTaskId: null });
  const footer = await screen.findByRole("button", { name: "Open Module Manager" });
  act(() => studioKeymapRegistry.setOverrides([{ context: "global", actionId: "toggle-module-manager",
    chord: { key: "G", control: true, shift: true, alt: false, meta: false } }]));
  try {
    expect(footer).toHaveTextContent("⌃⇧G");
    footer.focus();
    fireEvent.keyDown(footer, { key: "M", metaKey: true, shiftKey: true });
    expect(screen.queryByRole("region", { name: "Module Manager" })).toBeNull();
    fireEvent.keyDown(footer, { key: "G", ctrlKey: true, shiftKey: true });
    const manager = screen.getByRole("region", { name: "Module Manager" });
    const search = within(manager).getByRole("searchbox", { name: "Search modules" });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "/repos/module-2" } });
    expect(within(manager).getByRole("button", { name: "Inspect bugs" })).toBeVisible();
    expect(within(manager).queryByRole("button", { name: "Inspect Roadmap" })).toBeNull();
    expect(fireEvent.keyDown(search, { key: "ArrowLeft" })).toBe(true);
    expect(search).toHaveFocus();
    act(() => useModalStore.getState().pushModal({ type: "settings" }));
    fireEvent.keyDown(search, { key: "Escape" });
    expect(manager).toBeVisible();
    act(() => useModalStore.setState({ modalStack: [] }));
    fireEvent.change(search, { target: { value: "" } });
    const openHeader = within(manager).getByRole("button", { name: /^Open .*modules$/ });
    openHeader.focus();
    fireEvent.keyDown(openHeader, { key: "ArrowLeft" });
    expect(openHeader).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(openHeader, { key: "ArrowRight" });
    expect(openHeader).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(openHeader, { key: "ArrowDown" });
    expect(within(manager).getByRole("button", { name: "Inspect Roadmap" })).toHaveFocus();
    expect(useClientStore.getState().selectedModuleId).toBe("module-1");
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Module Manager" })).toBeNull());
  } finally { act(() => studioKeymapRegistry.setOverrides([])); }
});
