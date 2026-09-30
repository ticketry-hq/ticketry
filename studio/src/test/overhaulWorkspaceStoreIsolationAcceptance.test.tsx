import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DialogHost } from "../app/shell/DialogHost";
import ToastHost from "../app/shell/ToastHost";
import { useDialogStore } from "../app/shell/dialogStore";
import { useToastStore } from "../app/shell/toastStore";
import { useClientStore } from "../state/clientStore";

it("[overhaul-267] changes workspace focus without notifying or dismissing shell messages", async () => {
  render(<><DialogHost /><ToastHost /></>);
  let confirmation!: Promise<boolean>;
  act(() => {
    useToastStore.getState().pushToast("info", "Workspace ready");
    confirmation = useDialogStore.getState().confirm({ title: "Keep this dialog", body: "Pending choice", confirmLabel: "Keep" });
  });
  const dialogs = vi.fn();
  const toasts = vi.fn();
  const stopDialogs = useDialogStore.subscribe(dialogs);
  const stopToasts = useToastStore.subscribe(toasts);
  try {
    act(() => {
      const workspace = useClientStore.getState();
      workspace.setFocusedPane("tasks");
      workspace.selectTask("another-task");
      workspace.advanceWorkItemCursor("project-1", 17);
    });
    expect(dialogs).not.toHaveBeenCalled();
    expect(toasts).not.toHaveBeenCalled();
    expect(screen.getByText("Workspace ready")).toBeVisible();
    expect(screen.getByText("Pending choice")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    await expect(confirmation).resolves.toBe(true);
    expect(dialogs).toHaveBeenCalledTimes(1);
    expect(toasts).not.toHaveBeenCalled();
  } finally {
    stopDialogs();
    stopToasts();
  }
});
