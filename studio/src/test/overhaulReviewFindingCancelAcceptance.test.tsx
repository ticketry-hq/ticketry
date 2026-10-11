import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createWorkItemInvalidator } from "../features/agents/status/stream/workItemInvalidation";
import { DialogHost } from "../app/shell/DialogHost";
import { fixture, mountStudio, workItem } from "./seam";
import { studioApolloClient } from "../shared/apollo/client";
import { WorkTrackerModuleOpenDocument } from "../features/work-items/generated/workItems.documents";

const story = { id: "story", name: "Story", level: "task" as const, color: null, sort_order: 1 };
const implementation = { id: "implementation", name: "Implementation", level: "task" as const, color: null, sort_order: 2 };
const implement = { id: "implement", name: "Implement", group: "started", color: null, sort_order: 2 };
const review = { id: "review", name: "Review", group: "started", color: null, sort_order: 3 };
const cancelled = { id: "cancelled", name: "Cancelled", group: "cancelled", color: null, sort_order: 5 };

describe("overhaul acceptance — review findings", () => {
  it("keeps a cancelled finding visible in the parent Review panel", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: ["story-1", "other"],
      children: { "story-1": ["finding"], finding: [], other: [] },
      order: ["story-1", "finding", "other"],
    });
    http.workItems([
      workItem({
        id: "story-1", name: "Reviewed story", sequence_id: 501,
        issue_type: story, state: review, parent_id: "module-1", sub_issues_count: 1,
      }),
      workItem({
        id: "finding", name: "Integration finding", sequence_id: 502,
        description: "Path: src/a.ts\nLines: 1-2",
        issue_type: implementation, state: implement, parent_id: "story-1",
      }),
      // Registers the Cancelled state with the project workflow.
      workItem({
        id: "other", name: "Cancelled elsewhere", sequence_id: 503,
        issue_type: story, state: cancelled, parent_id: "module-1",
      }),
    ]);
    mountStudio({ http, selectedTaskId: "story-1" });
    render(<DialogHost />);

    const details = await screen.findByRole("region", { name: "Details" });
    const findings = await within(details).findByTestId("findings-panel", {}, { timeout: 5_000 });
    expect(within(findings).getByTestId("findings-queued-count")).toHaveTextContent("1 fix queued");

    fireEvent.click(within(findings).getByRole("button", { name: "Cancel T-502" }));
    await http.expectPatch("finding", { state_id: "cancelled", origin: "human" });
    // Converge module membership authoritatively, as the status feed does.
    await act(async () => {
      await studioApolloClient().refetchQueries({ include: [WorkTrackerModuleOpenDocument] });
    });

    await waitFor(() => {
      const panel = within(details).getByTestId("findings-panel");
      expect(within(panel).getByTestId("finding-state")).toHaveTextContent("Cancelled");
      expect(within(panel).getByTestId("findings-queued-count")).toHaveTextContent("0 fixes queued");
      expect(within(panel).queryByTestId("finding-cancel")).toBeNull();
    });
    expect(http.items.get("finding")?.is_archived).toBe(true);
  }, 20_000);

  it("streams a newly filed finding into the parent Review panel", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: ["story-1"], children: { "story-1": [] }, order: ["story-1"] });
    http.workItems([workItem({
      id: "story-1", name: "Reviewed story", sequence_id: 501,
      issue_type: story, state: review, parent_id: "module-1",
    })]);
    mountStudio({ http, selectedTaskId: "story-1" });
    render(<DialogHost />);
    const details = await screen.findByRole("region", { name: "Details" });
    await within(details).findByTestId("child-issues", {}, { timeout: 5_000 });
    expect(within(details).queryByTestId("findings-panel")).toBeNull();

    // The review agent files a finding through MCP; the status feed reports it.
    http.workItems([workItem({
      id: "finding", name: "Streamed finding", sequence_id: 502,
      issue_type: implementation, state: implement, parent_id: "story-1",
    })]);
    http.tree("module-1", {
      rootIds: ["story-1"], children: { "story-1": ["finding"], finding: [] }, order: ["story-1", "finding"],
    });
    const invalidator = createWorkItemInvalidator();
    act(() => {
      invalidator.record({ family: "work_item", workItemId: "finding", projectId: "project-1", moduleId: "module-1",
        itemKind: "task", removed: false, membershipChanged: true, occurredAt: null });
      invalidator.flush();
    });

    const panel = await within(details).findByTestId("findings-panel", {}, { timeout: 5_000 });
    expect(panel).toHaveTextContent("Streamed finding");
    expect(within(panel).getByTestId("findings-queued-count")).toHaveTextContent("1 fix queued");
  }, 20_000);
});
