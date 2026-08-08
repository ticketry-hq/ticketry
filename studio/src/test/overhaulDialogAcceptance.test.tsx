import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DialogHost } from "../app/shell/DialogHost";
import { useClientStore } from "../state/clientStore";

describe("overhaul acceptance — destructive confirmations", () => {
  beforeEach(() => {
    useClientStore.setState({ dialogs: [] });
  });

  it("[overhaul-20] renders the dialog bus and resolves both user choices", async () => {
    render(<DialogHost />);

    const cancelled = useClientStore.getState().confirm({
      title: "Delete issue",
      body: "TST-1 'Disposable story' will be permanently deleted.",
      confirmLabel: "Delete",
      danger: true,
    });
    expect(await screen.findByRole("dialog", { name: "Delete issue" }))
      .toHaveTextContent("TST-1 'Disposable story'");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(cancelled).resolves.toBe(false);

    const confirmed = useClientStore.getState().confirm({
      title: "Delete issue",
      body: "TST-1 'Disposable story' will be permanently deleted.",
      confirmLabel: "Delete",
      danger: true,
    });
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await expect(confirmed).resolves.toBe(true);
    expect(screen.queryByRole("dialog", { name: "Delete issue" }))
      .not.toBeInTheDocument();
  });
});
