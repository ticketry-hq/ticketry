import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixture, mountStudio, workItem } from "./seam";
import { setStatesSorted } from "../shared/query/stateCatalog";
import { dragWorkItem } from "./workItemDragGestures";

describe("overhaul acceptance — Stories and details", () => {
  it("[overhaul-25] keeps held work items in a state section after its catalog name changes", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: ["story-1"],
      children: { "story-1": [] },
      order: ["story-1"],
    });
    http.workItems([workItem({ id: "story-1", name: "Catalog-shaped story" })]);
    mountStudio({ http });

    const stories = await screen.findByRole("region", { name: "Stories" });
    expect(within(stories).getByRole("button", { name: "Collapse Ideas" }))
      .toHaveTextContent("Ideas1");

    act(() => {
      setStatesSorted("project-1", [
        {
          id: "state-1",
          name: "Intake",
          group: "backlog",
          color: null,
          sort_order: 0,
        },
      ]);
    });

    await waitFor(() => {
      expect(within(stories).getByRole("button", { name: "Collapse Intake" }))
        .toHaveTextContent("Intake1");
      expect(within(stories).getByRole("treeitem", { name: /Catalog-shaped story/ }))
        .toBeVisible();
    });
    expect(within(stories).queryByRole("button", { name: "Collapse Ideas" }))
      .toBeNull();
  });

  it("[overhaul-24] renders attachments from the work-item subcollection", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: ["story-1"],
      children: { "story-1": [] },
      order: ["story-1"],
    });
    http.workItems([workItem({ id: "story-1", name: "Attached story" })]);
    http.attachments("story-1", [
      {
        id: "attachment-1",
        issue: "story-1",
        filename: "implementation-notes.md",
        mime_type: "text/markdown",
        size: 2048,
        url: "/media/implementation-notes.md",
        created_at: "2026-08-09T12:00:00Z",
      },
    ]);
    mountStudio({ http, selectedTaskId: "story-1" });

    const details = screen.getByRole("region", { name: "Details" });
    const attachment = await within(details).findByRole("link", {
      name: /implementation-notes\.md/,
    });

    expect(attachment).toHaveAttribute("href", "/media/implementation-notes.md");
    expect(within(details).getByTestId("attachments")).toHaveTextContent("2.0 KB");
  });

  it("[overhaul-01] repaints every surface after fields, type, and parent change", async () => {
    const http = fixture();
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
      sort_order: 2,
    };
    http.tree("module-1", {
      rootIds: ["story-2"],
      children: { "story-1": [], "story-2": ["story-1"] },
      order: ["story-2", "story-1"],
    });
    http.workItems([
      workItem({
        id: "story-1",
        name: "Before",
        description: "Old copy",
        parent_id: "story-2",
        rank: "A",
      }),
      workItem({
        id: "story-2",
        name: "New parent",
        key: "MEML-2",
        issue_type: implementation,
        state: review,
        rank: "Z",
        sub_issues_count: 1,
      }),
    ]);
    mountStudio({ http });
    const stories = await screen.findByRole("region", { name: "Stories" });
    fireEvent.click(within(stories).getByRole("button", { name: "Expand subtasks" }));
    fireEvent.click(await within(stories).findByRole("treeitem", { name: /Before/ }));
    const details = screen.getByRole("region", { name: "Details" });
    expect(
      await within(details).findByText("Old copy", {}, { timeout: 5_000 }),
    ).toBeVisible();

    const typeChanged = http.expectPatch("story-1", {
      issue_type_id: "implementation",
    });
    const issueTypePicker = within(details).getByTestId("issue-type-picker");
    fireEvent.click(within(issueTypePicker).getByRole("button", { name: "Story" }));
    fireEvent.click(await screen.findByRole("button", { name: "Implementation" }));
    await typeChanged;
    expect(
      await within(issueTypePicker).findByRole("button", {
        name: "Implementation",
      }),
    ).toBeEnabled();

    http.workItems([
      workItem({
        id: "story-1",
        name: "After",
        description: "Fresh copy",
        issue_type: implementation,
        state: review,
        parent_id: "module-1",
        state_revision: 2,
        rank: "A",
      }),
      workItem({
        id: "story-2",
        name: "New parent",
        key: "MEML-2",
        issue_type: implementation,
        state: review,
        rank: "Z",
        sub_issues_count: 0,
      }),
    ]);
    http.tree("module-1", {
      rootIds: ["story-2", "story-1"],
      children: { "story-1": [], "story-2": [] },
      order: ["story-2", "story-1"],
    });
    http.notifications.workItemChanged("story-1", 2, true);

    await waitFor(() => expect(within(stories).getByText("After")).toBeVisible());
    expect(
      await within(details).findByText("Fresh copy", {}, { timeout: 5_000 }),
    ).toBeVisible();
    expect(
      within(within(details).getByTestId("issue-type-picker")).getByRole(
        "button",
        { name: "Implementation" },
      ),
    ).toBeVisible();
    expect(
      within(within(details).getByTestId("parent-picker")).getByRole("button", {
        name: "T-1",
      }),
    ).toBeVisible();
    expect(within(details).getByRole("button", { name: "Review" })).toBeVisible();
    expect(within(stories).queryByText("Before")).toBeNull();
  });

  it("[overhaul-02] moves a grilled Story back to Ideas immediately", async () => {
    const http = fixture();
    const grill = {
      id: "grill",
      name: "Grill",
      group: "backlog",
      color: null,
      sort_order: 2,
    };
    http.tree("module-1", {
      rootIds: ["story-1", "ideas-seed"],
      children: { "story-1": [], "ideas-seed": [] },
      order: ["story-1", "ideas-seed"],
    });
    http.workItems([
      workItem({ id: "story-1", name: "Moving story", state: grill, rank: "Z" }),
      workItem({
        id: "ideas-seed",
        name: "Already an idea",
        key: "MEML-2",
        rank: "A",
      }),
    ]);
    const patched = http.expectPatch("story-1", {
      state_id: "state-1",
      origin: "human",
    });
    mountStudio({ http });
    const stories = await screen.findByRole("region", { name: "Stories" });
    fireEvent.click(within(stories).getByRole("treeitem", { name: /Moving story/ }));
    const details = screen.getByRole("region", { name: "Details" });

    fireEvent.click(await within(details).findByRole("button", { name: "Grill" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ideas" }));

    await patched;
    await waitFor(() => {
      const stateSections = within(stories).getAllByRole("button", {
        name: /^Collapse (Ideas|Grill)$/,
      });
      expect(stateSections[0]).toHaveAccessibleName("Collapse Ideas");
      expect(
        within(stories).queryByRole("button", { name: "Collapse Idea" }),
      ).toBeNull();
      expect(within(stories).getByRole("button", { name: "Collapse Grill" }))
        .toHaveTextContent("Grill0");
      expect(within(stories).getByRole("button", { name: "Collapse Ideas" }))
        .toHaveTextContent("Ideas2");
    });
  });

  it("[overhaul-79] lets a person move a Story directly from Ideas to Implement", async () => {
    const http = fixture();
    const implement = {
      id: "implement",
      name: "Implement",
      group: "started",
      color: null,
      sort_order: 4,
    };
    http.tree("module-1", {
      rootIds: ["story-1", "implement-seed"],
      children: { "story-1": [], "implement-seed": [] },
      order: ["story-1", "implement-seed"],
    });
    http.workItems([
      workItem({ id: "story-1", name: "Ready for direct kickoff" }),
      workItem({
        id: "implement-seed",
        name: "Already implementing",
        key: "MEML-2",
        state: implement,
      }),
    ]);
    const patched = http.expectPatch("story-1", {
      state_id: "implement",
      origin: "human",
    });
    mountStudio({ http });

    const stories = await screen.findByRole("region", { name: "Stories" });
    fireEvent.click(
      within(stories).getByRole("treeitem", { name: /Ready for direct kickoff/ }),
    );
    const details = screen.getByRole("region", { name: "Details" });
    fireEvent.click(await within(details).findByRole("button", { name: "Ideas" }));
    fireEvent.click(await screen.findByRole("button", { name: "Implement" }));

    await patched;
    await waitFor(() => {
      expect(within(stories).getByRole("button", { name: "Collapse Ideas" }))
        .toHaveTextContent("Ideas0");
      expect(within(stories).getByRole("button", { name: "Collapse Implement" }))
        .toHaveTextContent("Implement2");
    });
  });

  it("[overhaul-03] leaves a dragged row where dropped after the server reply", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: ["top", "bottom"],
      children: { top: [], bottom: [] },
      order: ["top", "bottom"],
    });
    http.workItems([
      workItem({ id: "top", name: "Top", rank: "A" }),
      workItem({ id: "bottom", name: "Bottom", key: "MEML-2", rank: "Z" }),
    ]);
    const reordered = http.expectReorder("bottom", {
      before_id: null,
      after_id: "top",
    });
    mountStudio({ http });
    const stories = await screen.findByRole("region", { name: "Stories" });
    const source = within(stories).getByRole("treeitem", { name: /Bottom/ });
    const target = within(stories).getByRole("treeitem", { name: /Top/ });
    dragWorkItem(source, target, "before");
    await reordered;

    expect(within(stories).getAllByRole("treeitem").map((row) => row.getAttribute("data-task-id")))
      .toEqual(["__scratch__", "bottom", "top"]);
  });

  it("[overhaul-04] visibly reverts a write refused by the server", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: ["story-1"],
      children: { "story-1": [] },
      order: ["story-1"],
    });
    http.workItems([workItem({ id: "story-1", name: "Accepted name" })]);
    mountStudio({ http });
    const stories = await screen.findByRole("region", { name: "Stories" });
    fireEvent.click(within(stories).getByRole("treeitem", { name: /Accepted name/ }));
    const details = screen.getByRole("region", { name: "Details" });
    fireEvent.click(await within(details).findByText("Accepted name"));
    const name = within(details).getByRole("textbox", { name: "Name" });
    fireEvent.change(name, { target: { value: "Refused name" } });
    http.failNext(409, { detail: "conflict" });
    fireEvent.keyDown(name, { key: "Enter" });

    expect(await within(stories).findByText("Accepted name")).toBeVisible();
    expect(within(stories).queryByText("Refused name")).toBeNull();
  });

  it("[overhaul-06] cycles through an already loaded list without a loading flash", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: ["story-1", "story-2", "story-3"],
      children: { "story-1": [], "story-2": [], "story-3": [] },
      order: ["story-1", "story-2", "story-3"],
    });
    http.workItems([
      workItem({ id: "story-1", name: "First", rank: "Z" }),
      workItem({ id: "story-2", name: "Second", key: "MEML-2", rank: "M" }),
      workItem({ id: "story-3", name: "Third", key: "MEML-3", rank: "A" }),
    ]);
    mountStudio({ http });

    const stories = await screen.findByRole("region", { name: "Stories" });
    const details = screen.getByRole("region", { name: "Details" });
    for (const name of ["First", "Second", "Third", "First"]) {
      fireEvent.click(within(stories).getByRole("treeitem", { name: new RegExp(name) }));
      expect(await within(details).findByText(name)).toBeVisible();
      expect(within(details).queryByText("Loading issue…")).toBeNull();
      expect(within(stories).queryByText("…")).toBeNull();
    }
  });

  it("[overhaul-07] keeps descendant activity on a collapsed branch summary", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: ["story-1"],
      children: { "story-1": ["child-1"], "child-1": [] },
      order: ["story-1", "child-1"],
    });
    http.workItems([
      workItem({
        id: "story-1",
        name: "Parent story",
        rank: "Z",
        sub_issues_count: 1,
      }),
      workItem({
        id: "child-1",
        name: "Implementation child",
        key: "MEML-2",
        parent_id: "story-1",
        rank: "A",
      }),
    ]);
    http.runs("child-1", [
      {
        agent_run_id: "run-child",
        task_id: "child-1",
        module_id: "module-1",
        scope: "task",
        state: "working",
        started_at: "2026-08-07T12:00:00Z",
        updated_at: "2026-08-07T12:00:00Z",
      },
    ]);
    mountStudio({ http });

    const stories = await screen.findByRole("region", { name: "Stories" });
    const parent = within(stories).getByRole("treeitem", { name: /Parent story/ });
    expect(parent).toHaveAttribute("aria-expanded", "false");
    expect(within(stories).queryByText("Implementation child")).toBeNull();

    http.notifications.runLifecycle(
      "run-child",
      "working",
      "2026-08-07T12:00:01Z",
    );

    expect(await within(parent).findByTestId("agent-state-badge")).toHaveTextContent("▶1");
    expect(within(stories).queryByText("Implementation child")).toBeNull();
  });
});
