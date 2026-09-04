import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useApolloClient } from "@apollo/client/react";
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fixture, mountStudio, workItem } from "./seam";
import { WorkTrackerAttachmentsDocument } from "../features/work-items/generated/workItems.documents";
import { useWorkItemAttachments } from "../features/work-items";
import { compactWorktrackerId } from "../shared/api/generatedWorktracker";
import { useClientStore } from "../state/clientStore";
import { setStatesSorted } from "../features/projects";
import { useStoriesTree } from "../features/work-items";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { TEMP_TASK_ID } from "../features/agents/types";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { finishWorkItemDragWithoutDrop } from "./workItemDragGestures";
import { SelectedTicket } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicket";
import { useWorkflowEditorStore } from "../features/workflows/workflowEditorStore";

function AttachmentCacheProbe({ issueId }: { issueId: string }) {
  const client = useApolloClient();
  const [cacheKey, setCacheKey] = useState("");

  useEffect(() => client.cache.watch({
    query: WorkTrackerAttachmentsDocument,
    variables: { issueId: compactWorktrackerId(issueId) },
    optimistic: true,
    immediate: true,
    callback: ({ result }) => {
      const attachment = result?.attachments?.nodes?.[0];
      setCacheKey(attachment ? client.cache.identify(attachment) ?? "" : "");
    },
  }), [client, issueId]);

  return <output data-testid="attachment-cache-key">{cacheKey}</output>;
}

function AttachmentErrorProbe() {
  const issueId = useClientStore((state) => state.selectedTaskId);
  const { error } = useWorkItemAttachments(issueId);
  const message = error instanceof Error ? error.message : "";
  const code = error && "code" in error ? String(error.code) : "";
  return <output data-testid="attachment-error">{code}:{message}</output>;
}

function StoriesKeyboardHarness() {
  const { rows } = useStoriesTree();
  useGlobalKeymap(rows);
  return null;
}

async function pressStoryArrow(
  key: "ArrowDown" | "ArrowUp",
  repeat = false,
): Promise<void> {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        repeat,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

describe("overhaul acceptance — Stories and details", () => {
  it("[overhaul-172] accepts every rapid and repeated Stories arrow keydown", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const http = fixture();
    const graphQlRequests: Array<{
      operationName: string | null;
      variables: unknown;
    }> = [];
    const worktreeRequests: string[] = [];
    http.tree("module-1", {
      rootIds: ["story-1", "story-2", "story-3", "story-4"],
      children: {
        "story-1": [],
        "story-2": [],
        "story-3": [],
        "story-4": [],
      },
      order: ["story-1", "story-2", "story-3", "story-4"],
    });
    http.workItems([
      workItem({ id: "story-1", name: "First", rank: "A" }),
      workItem({ id: "story-2", name: "Second", key: "MEML-2", rank: "B" }),
      workItem({ id: "story-3", name: "Third", key: "MEML-3", rank: "C" }),
      workItem({ id: "story-4", name: "Fourth", key: "MEML-4", rank: "D" }),
    ]);
    http.attachments("story-4", [
      {
        id: "attachment-4",
        issue: "story-4",
        filename: "fourth.md",
        mime_type: "text/markdown",
        size: 512,
        url: "/media/fourth.md",
        created_at: "2026-08-27T12:00:00Z",
      },
    ]);
    const executeGraphQl = http.executeGraphQl.bind(http);
    mountStudio({
      http,
      selectedTaskId: "story-1",
      children: <StoriesKeyboardHarness />,
      graphQlExecute: async (document, variables) => {
        const operationName = documentOperationName(document);
        if (operationName === "WorktreeStatus") {
          const taskId = (variables as { taskId: string }).taskId;
          worktreeRequests.push(taskId);
          return {
            worktree_status: {
              __typename: "WorktreeStatusView",
              kind: "none",
              task_id: taskId,
              top_level_task_id: taskId,
              is_shared: false,
              branch: null,
              base_branch: null,
              path: null,
              state: null,
              clean: null,
              dirty: null,
              ahead: null,
              behind: null,
              conflict: null,
              checkout_present: null,
              ephemeral: false,
              reason: null,
            },
          } as never;
        }
        graphQlRequests.push({ operationName, variables });
        return executeGraphQl(document, variables);
      },
    });
    useClientStore.setState({
      sidebarVisible: false,
      editViewZone: "stories",
      editViewBodyEngaged: false,
    });

    const stories = await screen.findByRole("region", { name: "Stories" });
    const details = screen.getByRole("region", { name: "Details" });
    await within(details).findByText("First");
    await waitFor(() => expect(worktreeRequests).toEqual(["story-1"]));
    worktreeRequests.length = 0;
    graphQlRequests.length = 0;

    const selectedIds: Array<string | null> = [];
    const unsubscribe = useClientStore.subscribe((state, previous) => {
      if (state.selectedTaskId !== previous.selectedTaskId) {
        selectedIds.push(state.selectedTaskId);
      }
    });

    await pressStoryArrow("ArrowDown");
    await pressStoryArrow("ArrowDown", true);
    await pressStoryArrow("ArrowDown", true);
    await pressStoryArrow("ArrowUp", true);
    await pressStoryArrow("ArrowUp", true);
    await pressStoryArrow("ArrowUp", true);
    await pressStoryArrow("ArrowUp", true);
    await pressStoryArrow("ArrowUp", true);

    expect(selectedIds).toEqual([
      "story-2",
      "story-3",
      "story-4",
      "story-3",
      "story-2",
      "story-1",
      TEMP_TASK_ID,
    ]);
    expect(document.activeElement).toBe(
      within(stories).getByRole("textbox", { name: "Capture an idea" }),
    );

    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    selectedIds.length = 0;
    await pressStoryArrow("ArrowDown");
    await pressStoryArrow("ArrowDown", true);
    await pressStoryArrow("ArrowDown", true);
    await pressStoryArrow("ArrowDown", true);

    expect(selectedIds).toEqual(["story-1", "story-2", "story-3", "story-4"]);
    expect(
      within(stories).getByRole("treeitem", { name: /Fourth/ }),
    ).toHaveAttribute("aria-selected", "true");
    expect(await within(details).findByText("Fourth")).toBeVisible();
    expect(await within(details).findByRole("link", { name: /fourth\.md/ }))
      .toBeVisible();

    const attachmentCalls = graphQlRequests.filter(
      ({ operationName }) => operationName === "WorkTrackerAttachments",
    );
    expect(attachmentCalls.map(({ variables }) => variables)).toEqual([
      { issueId: "story-4" },
    ]);
    expect(
      graphQlRequests.filter(
        ({ operationName }) => operationName === "WorkTrackerWorkItem",
      ),
    ).toEqual([]);
    await waitFor(() => expect(worktreeRequests).toEqual(["story-4"]));

    unsubscribe();
  });

  it("[overhaul-126] opens and closes the correct state configuration from its Stories header", async () => {
    useWorkflowEditorStore.setState({
      projectId: "project-1",
      issueTypes: [],
      states: [],
      stateWorkItemCounts: {},
      providerCapabilities: [],
      selectedTypeId: null,
      workflows: {},
      stagedStateIds: {},
      loading: false,
      action: null,
      notice: null,
      error: null,
      controlErrors: {},
    });
    const http = fixture();
    const review = {
      id: "review",
      name: "Review",
      group: "started",
      color: null,
      sort_order: 2,
    };
    http.tree("module-1", {
      rootIds: ["story-1", "story-2"],
      children: { "story-1": [], "story-2": [] },
      order: ["story-1", "story-2"],
    });
    http.workItems([
      workItem({ id: "story-1", name: "Idea story" }),
      workItem({
        id: "story-2",
        name: "Review story",
        key: "MEML-2",
        state: review,
      }),
    ]);
    mountStudio({
      http,
      selectedTaskId: "story-1",
      children: <SelectedTicket />,
    });

    const stories = await screen.findByRole("region", { name: "Stories" });
    const configureReview = await within(stories).findByRole("button", {
      name: "Configure Review state",
    });

    fireEvent.click(configureReview);
    await screen.findByRole("region", {
      name: "Review state configuration",
    });
    expect(useClientStore.getState().workspaceSelection).toEqual({
      kind: "state-configuration",
      projectId: "project-1",
      stateId: "review",
    });
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Review state configuration" }),
      ).toBeVisible(),
    );
    expect(
      screen.queryByRole("region", { name: "Ideas state configuration" }),
    ).toBeNull();

    const panel = screen.getByRole("region", {
      name: "Review state configuration",
    });
    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Close Review state configuration",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Review state configuration" }),
      ).toBeNull(),
    );
  }, 15_000);

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
    expect(await within(stories).findByRole("button", { name: "Collapse Ideas" }))
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
    mountStudio({
      http,
      selectedTaskId: "story-1",
      children: <AttachmentCacheProbe issueId="story-1" />,
    });

    const details = screen.getByRole("region", { name: "Details" });
    const attachment = await within(details).findByRole("link", {
      name: /implementation-notes\.md/,
    });

    expect(attachment).toHaveAttribute("href", "/media/implementation-notes.md");
    expect(within(details).getByTestId("attachments")).toHaveTextContent("2.0 KB");
    expect(await screen.findByTestId("attachment-cache-key")).toHaveTextContent(
      'WorktrackerAttachment:{"id":"attachment-1"}',
    );
  });

  it("keeps the attachment domain error contract on the Apollo read", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: ["story-1"],
      children: { "story-1": [] },
      order: ["story-1"],
    });
    http.workItems([workItem({ id: "story-1", name: "Attached story" })]);
    mountStudio({ http, children: <AttachmentErrorProbe /> });

    const stories = await screen.findByRole("region", { name: "Stories" });
    const row = await within(stories).findByRole("treeitem", {
      name: /Attached story/,
    });
    http.failNext(409, { detail: "Attachment read conflicted." });
    fireEvent.click(row);

    expect(await screen.findByTestId("attachment-error")).toHaveTextContent(
      "conflict:Attachment read conflicted.",
    );
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
    fireEvent.click(await within(stories).findByRole("button", { name: "Expand subtasks" }));
    fireEvent.click(await within(stories).findByRole("treeitem", { name: /Before/ }));
    const details = screen.getByRole("region", { name: "Details" });
    expect(
      await within(details).findByText("Old copy", {}, { timeout: 5_000 }),
    ).toBeVisible();

    const typeChanged = http.expectPatch("story-1", {
      issue_type_id: "implementation",
    });
    const issueTypePicker = within(details).getByTestId("issue-type-picker");
    const issueTypeTrigger = within(issueTypePicker).getByRole("button", {
      name: "Story",
    });
    expect(issueTypeTrigger).not.toHaveClass("border", "border-pane-border");
    const issueTypeLabel = within(issueTypePicker).getByTestId("issue-type-label");
    expect(issueTypeLabel).toHaveClass(
      "border",
      "border-pane-border",
      "bg-pane-bg",
      "px-1.5",
      "py-0.5",
    );
    expect(issueTypeLabel).not.toHaveClass("rounded");
    fireEvent.click(issueTypeTrigger);
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
    fireEvent.click(await within(stories).findByRole("treeitem", { name: /Moving story/ }));
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

  it("[overhaul-133] lets a person move a Story directly from Ideas to Implement", async () => {
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
      await within(stories).findByRole("treeitem", { name: /Ready for direct kickoff/ }),
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
    const topId = "11111111111111111111111111111111";
    const bottomId = "22222222222222222222222222222222";
    http.tree("module-1", {
      rootIds: [topId, bottomId],
      children: { [topId]: [], [bottomId]: [] },
      order: [topId, bottomId],
    });
    http.workItems([
      workItem({ id: topId, name: "Top", rank: "A" }),
      workItem({ id: bottomId, name: "Bottom", key: "MEML-2", rank: "Z" }),
    ]);
    const reordered = http.expectReorder(bottomId, {
      before_id: null,
      after_id: topId,
    });
    mountStudio({ http });
    const stories = await screen.findByRole("region", { name: "Stories" });
    const source = await within(stories).findByRole("treeitem", { name: /Bottom/ });
    const target = await within(stories).findByRole("treeitem", { name: /Top/ });
    finishWorkItemDragWithoutDrop(source, target, "before");
    await reordered;

    await waitFor(() => {
      expect(within(stories).getAllByRole("treeitem").map((row) => row.getAttribute("data-task-id")))
        .toEqual([
          "__scratch__",
          "22222222-2222-2222-2222-222222222222",
          "11111111-1111-1111-1111-111111111111",
        ]);
    });
  });

  it("keeps the destination order after moving a Story to another state", async () => {
    const http = fixture();
    const ideasId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const implementId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const sourceId = "11111111111111111111111111111111";
    const targetId = "22222222222222222222222222222222";
    http.tree("module-1", {
      rootIds: [sourceId, targetId],
      children: { [sourceId]: [], [targetId]: [] },
      order: [sourceId, targetId],
    });
    http.workItems([
      workItem({
        id: sourceId,
        name: "Move to Implement",
        rank: "Z",
        state: {
          id: ideasId,
          name: "Ideas",
          group: "backlog",
          color: null,
          sort_order: 1,
        },
      }),
      workItem({
        id: targetId,
        name: "Already implementing",
        key: "MEML-2",
        rank: "M",
        state: {
          id: implementId,
          name: "Implement",
          group: "started",
          color: null,
          sort_order: 2,
        },
      }),
    ]);
    const transitioned = http.expectPatch(sourceId, {
      state_id: implementId,
      origin: "human",
    });
    const reordered = http.expectReorder(sourceId, {
      before_id: null,
      after_id: targetId,
    });
    mountStudio({ http });

    const stories = await screen.findByRole("region", { name: "Stories" });
    const source = await within(stories).findByRole("treeitem", { name: /Move to Implement/ });
    const target = await within(stories).findByRole("treeitem", { name: /Already implementing/ });
    finishWorkItemDragWithoutDrop(source, target, "before");

    await transitioned;
    await reordered;
    await waitFor(() => {
      expect(within(stories).getAllByRole("treeitem").map((row) => row.getAttribute("data-task-id")))
        .toEqual([
          "__scratch__",
          "11111111-1111-1111-1111-111111111111",
          "22222222-2222-2222-2222-222222222222",
        ]);
    });
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
    fireEvent.click(await within(stories).findByRole("treeitem", { name: /Accepted name/ }));
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
      fireEvent.click(await within(stories).findByRole("treeitem", { name: new RegExp(name) }));
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
    const parent = await within(stories).findByRole("treeitem", { name: /Parent story/ });
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
