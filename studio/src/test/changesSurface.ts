import { fireEvent, screen } from "@testing-library/react";

export async function openBranchInspector(): Promise<void> {
  const toggle = await screen.findByRole("button", { name: "Branch" });
  if (toggle.getAttribute("aria-pressed") !== "true") fireEvent.click(toggle);
  await screen.findByTestId("changes-branch-inspector");
}

export async function openWorktreeCheckouts(): Promise<void> {
  const trigger = await screen.findByRole("button", { name: "Choose checkout" });
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  await screen.findByRole("region", { name: "Worktree checkouts" });
}

export async function openInspectorSection(title: string): Promise<void> {
  await openBranchInspector();
  const summary = await screen.findByText(title, { selector: "summary" });
  const disclosure = summary.closest("details");
  if (disclosure?.open) return;
  fireEvent.click(summary);
}
