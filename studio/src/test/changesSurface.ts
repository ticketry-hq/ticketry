import { fireEvent, screen } from "@testing-library/react";

/**
 * Open the branch inspector, where every Changes command but the primary lives.
 *
 * The inspector is closed by default so files and diff own the window, so a
 * test that drives Commit, Push, pull-request lifecycle, local merge, or
 * worktree cleanup opens it the way a reader does.
 */
export async function openBranchInspector(): Promise<void> {
  const toggle = await screen.findByRole("button", { name: "Branch" });
  if (toggle.getAttribute("aria-pressed") === "true") return;
  fireEvent.click(toggle);
  await screen.findByTestId("changes-branch-inspector");
}

/** Open the worktree switcher that replaced the permanent checkouts column. */
export async function openWorktreeCheckouts(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Change worktree checkout" }));
  await screen.findByRole("region", { name: "Worktree checkouts" });
}

/** Expand one branch-inspector section by its summary title. */
export async function openInspectorSection(title: string): Promise<void> {
  await openBranchInspector();
  const summary = await screen.findByText(title, { selector: "summary" });
  const disclosure = summary.closest("details");
  if (disclosure?.open) return;
  fireEvent.click(summary);
}
