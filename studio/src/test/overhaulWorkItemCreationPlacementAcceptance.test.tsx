import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  documentOperationName,
  type TypedDocumentNode,
} from "../graphql-foundation/typedDocument";
import { WorkTrackerWorkItemDocument } from "../features/work-items/generated/workItems.documents";
import { compactWorktrackerId } from "../shared/api/generatedWorktracker";
import { fixture, mountStudio, workItem } from "./seam";

function visibleWorkItemNames(stories: HTMLElement): string[] {
  return within(stories)
    .getAllByRole("treeitem")
    .filter((row) => row.getAttribute("data-task-id") !== "__scratch__")
    .map((row) => row.textContent ?? "");
}

describe("work-item creation placement acceptance", () => {
  it("[overhaul-240] keeps a new Story first while creation is pending and after the authoritative reply", async () => {
    const http = fixture();
    const existingId = "11111111111111111111111111111111";
    const createdId = "22222222222222222222222222222222";
    const readyState = {
      id: "ready-state",
      name: "Ready",
      group: "backlog",
      color: null,
      sort_order: 1,
    };
    const storyType = {
      id: "story-type",
      name: "Story",
      level: "task" as const,
      color: null,
      sort_order: 1,
      start_state: readyState.id,
    };
    const existing = workItem({
      id: existingId,
      name: "Existing first Story",
      rank: "M",
      state: readyState,
      issue_type: storyType,
    });
    const created = workItem({
      id: createdId,
      name: "New first Story",
      key: "MEML-2",
      sequence_id: 2,
      rank: "A",
      state: readyState,
      issue_type: storyType,
    });
    http.tree("module-1", {
      rootIds: [existingId],
      children: { [existingId]: [] },
      order: [existingId],
    });
    http.workItems([existing]);

    let releaseCreate = (): void => {};
    const createHeld = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    let markCreateRequested = (): void => {};
    const createRequested = new Promise<void>((resolve) => {
      markCreateRequested = resolve;
    });
    const graphQlExecute = async <TResult, TVariables>(
      document: TypedDocumentNode<TResult, TVariables>,
      variables: TVariables,
    ): Promise<TResult> => {
      if (documentOperationName(document) !== "CreateWorkTrackerWorkItem") {
        return http.executeGraphQl(document, variables);
      }

      markCreateRequested();
      await createHeld;
      http.workItems([created]);
      http.tree("module-1", {
        rootIds: [createdId, existingId],
        children: { [createdId]: [], [existingId]: [] },
        order: [createdId, existingId],
      });
      const lookup = await http.executeGraphQl(WorkTrackerWorkItemDocument, {
        id: compactWorktrackerId(createdId),
      });
      return {
        create_work_item: lookup.work_item.nodes[0],
      } as TResult;
    };

    mountStudio({ http, graphQlExecute });
    const stories = await screen.findByRole("region", { name: "Stories" });
    const ideaEntry = within(stories).getByRole("textbox", {
      name: "Capture an idea",
    });
    expect(await within(stories).findByText("Existing first Story")).toBeVisible();

    fireEvent.change(ideaEntry, { target: { value: "New first Story" } });
    fireEvent.keyDown(ideaEntry, { key: "Enter" });
    await createRequested;

    expect(ideaEntry).toHaveAttribute("aria-busy", "true");
    await waitFor(() => {
      expect(visibleWorkItemNames(stories)).toEqual([
        expect.stringContaining("New first Story"),
        expect.stringContaining("Existing first Story"),
      ]);
    });

    releaseCreate();

    await waitFor(() => expect(ideaEntry).toHaveAttribute("aria-busy", "false"));
    await waitFor(() => {
      expect(visibleWorkItemNames(stories)).toEqual([
        expect.stringContaining("New first Story"),
        expect.stringContaining("Existing first Story"),
      ]);
    });
  });
});
