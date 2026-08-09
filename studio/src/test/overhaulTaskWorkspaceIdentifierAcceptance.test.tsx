import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DialogHost } from "../app/shell/DialogHost";
import { fixture, mountStudio, workItem } from "./seam";

const story = {
  id: "story",
  name: "Story",
  level: "task" as const,
  color: null,
  sort_order: 1,
};
const implementation = {
  id: "implementation",
  name: "Implementation",
  level: "task" as const,
  color: null,
  sort_order: 2,
};
const review = {
  id: "review",
  name: "Review",
  group: "started",
  color: null,
  sort_order: 3,
};
const implement = {
  id: "implement",
  name: "Implement",
  group: "started",
  color: null,
  sort_order: 2,
};

describe("overhaul acceptance — Task workspace identifiers", () => {
  it("[overhaul-34] names every related work item in the Task workspace as T-<number>", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: ["selected", "blocker", "dependent"],
      children: {
        selected: ["finding", "child"],
        finding: [],
        child: [],
        blocker: [],
        dependent: [],
      },
      order: ["selected", "finding", "child", "blocker", "dependent"],
    });
    http.workItems([
      workItem({
        id: "selected",
        name: "Selected story",
        key: "MEML-CANONICAL-401",
        sequence_id: 401,
        issue_type: story,
        state: review,
        parent_id: "module-1",
        sub_issues_count: 2,
        blocked_by_ids: ["blocker"],
        blocks_ids: ["dependent"],
      }),
      workItem({
        id: "finding",
        name: "Finding one",
        key: "MEML-CANONICAL-402",
        sequence_id: 402,
        issue_type: implementation,
        state: implement,
        parent_id: "selected",
      }),
      workItem({
        id: "child",
        name: "Ordinary child",
        key: "MEML-CANONICAL-403",
        sequence_id: 403,
        issue_type: story,
        state: implement,
        parent_id: "selected",
      }),
      workItem({
        id: "blocker",
        name: "Blocking work",
        key: "MEML-CANONICAL-404",
        sequence_id: 404,
        issue_type: story,
        state: implement,
        parent_id: "module-1",
        blocks_ids: ["selected"],
      }),
      workItem({
        id: "dependent",
        name: "Dependent work",
        key: "MEML-CANONICAL-405",
        sequence_id: 405,
        issue_type: story,
        state: implement,
        parent_id: "module-1",
        blocked_by_ids: ["selected"],
      }),
    ]);
    mountStudio({ http, selectedTaskId: "selected" });
    render(<DialogHost />);

    const details = await screen.findByRole("region", { name: "Details" });

    // Related work: child issues and review findings.
    const childIssues = await within(details).findByTestId(
      "child-issues",
      {},
      { timeout: 5_000 },
    );
    expect(within(childIssues).getByText("T-402")).toBeVisible();
    expect(within(childIssues).getByText("T-403")).toBeVisible();
    const findings = within(details).getByTestId("findings-panel");
    expect(within(findings).getByText("T-402")).toBeVisible();
    expect(
      within(findings).getByRole("button", { name: "Cancel T-402" }),
    ).toBeVisible();

    // Dependency chips read the referenced work item's sequence identifier.
    expect(
      within(within(details).getByTestId("blocked-by-row")).getByText("T-404"),
    ).toBeVisible();
    expect(
      within(within(details).getByTestId("blocks-row")).getByText("T-405"),
    ).toBeVisible();

    // Blocker-picker candidates match the chips they create.
    const blockerPicker = within(details).getByTestId("blocker-picker");
    fireEvent.click(
      within(blockerPicker).getByRole("button", { name: "Add blocker" }),
    );
    expect(
      within(blockerPicker).getByRole("button", { name: "T-402 Finding one" }),
    ).toBeVisible();
    expect(
      within(blockerPicker).getByRole("button", { name: "T-403 Ordinary child" }),
    ).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });

    // Parent picker: the closed trigger and both option groups, plus the
    // Module link, name a Module by the same convention as a task.
    const parentPicker = within(details).getByTestId("parent-picker");
    expect(within(details).getByTestId("epic-link")).toHaveTextContent("T-1");
    fireEvent.click(within(parentPicker).getByRole("button", { name: "T-1" }));
    expect(
      within(parentPicker).getByRole("button", { name: "T-1 Module 1" }),
    ).toBeVisible();
    expect(
      within(parentPicker).getByRole("button", { name: "T-404 Blocking work" }),
    ).toBeVisible();
    expect(
      within(parentPicker).getByRole("button", { name: "T-405 Dependent work" }),
    ).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });

    // No canonical project-qualified key reaches the Task workspace.
    expect(details).not.toHaveTextContent("MEML-CANONICAL");
    expect(details).not.toHaveTextContent("MODULE-1");
    expect(details).not.toHaveTextContent(/T-(null|undefined)/);

    // Destructive confirmation names the selected work item the same way.
    fireEvent.click(
      within(within(details).getByTestId("blocked-by-row")).getByRole("button", {
        name: "T-404",
      }),
    );
    expect(
      await within(details).findByTestId("issue-name", {}, { timeout: 5_000 }),
    ).toHaveTextContent("Blocking work");
    fireEvent.click(within(details).getByTestId("issue-actions-trigger"));
    fireEvent.click(within(details).getByTestId("delete-issue"));

    const confirmation = await screen.findByRole("dialog", { name: "Delete issue" });
    expect(confirmation).toHaveTextContent(
      "T-404 'Blocking work' will be permanently deleted.",
    );
    expect(confirmation).not.toHaveTextContent("MEML-CANONICAL-404");
    fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
  });
});
