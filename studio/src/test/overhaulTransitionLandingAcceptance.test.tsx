import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  documentOperationName,
  type TypedDocumentNode,
} from "../graphql-foundation/typedDocument";
import { fixture, mountStudio, workItem } from "./seam";
import { dragWorkItem } from "./workItemDragGestures";

function visibleWorkItemIds(stories: HTMLElement): Array<string | null> {
  return within(stories)
    .getAllByRole("treeitem")
    .filter((row) => row.getAttribute("data-task-id") !== "__scratch__")
    .map((row) => row.getAttribute("data-task-id"));
}

describe("overhaul acceptance — transition landing", () => {
  it("[overhaul-247] keeps a transitioned Story first while pending and after the authoritative reply", async () => {
    const http = fixture();
    const sourceId = "11111111111111111111111111111111";
    const destinationFirstId = "22222222222222222222222222222222";
    const grill = {
      id: "grill",
      name: "Grill",
      group: "backlog",
      color: null,
      sort_order: 2,
    };
    const implement = {
      id: "implement",
      name: "Implement",
      group: "started",
      color: null,
      sort_order: 4,
    };
    http.tree("module-1", {
      rootIds: [destinationFirstId, sourceId],
      children: { [sourceId]: [], [destinationFirstId]: [] },
      order: [destinationFirstId, sourceId],
    });
    http.workItems([
      workItem({
        id: destinationFirstId,
        name: "Previous first",
        key: "MEML-2",
        rank: "M",
        state: implement,
      }),
      workItem({
        id: sourceId,
        name: "Move first",
        rank: "Z",
        state: grill,
      }),
    ]);
    http.transitionRank(sourceId, "A");

    let releaseTransition = (): void => {};
    const transitionHeld = new Promise<void>((resolve) => {
      releaseTransition = resolve;
    });
    let markTransitionRequested = (): void => {};
    const transitionRequested = new Promise<void>((resolve) => {
      markTransitionRequested = resolve;
    });
    const graphQlExecute = async <TResult, TVariables>(
      document: TypedDocumentNode<TResult, TVariables>,
      variables: TVariables,
    ): Promise<TResult> => {
      if (documentOperationName(document) !== "TransitionWorkTrackerWorkItem") {
        return http.executeGraphQl(document, variables);
      }

      markTransitionRequested();
      await transitionHeld;
      return http.executeGraphQl(document, variables);
    };

    mountStudio({ http, graphQlExecute });
    const stories = await screen.findByRole("region", { name: "Stories" });
    const details = screen.getByRole("region", { name: "Details" });
    expect(await within(stories).findByText("Previous first")).toBeVisible();
    fireEvent.click(
      within(stories).getByRole("treeitem", { name: /Move first/ }),
    );

    fireEvent.click(await within(details).findByRole("button", { name: "Grill" }));
    fireEvent.click(await screen.findByRole("button", { name: "Implement" }));
    await transitionRequested;

    const statePicker = within(details).getByTestId("state-picker");
    await waitFor(() => expect(statePicker).toHaveTextContent("…"));
    await waitFor(() => {
      expect(visibleWorkItemIds(stories)).toEqual([
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
      ]);
    });

    releaseTransition();

    await http.expectPatch(sourceId, {
      state_id: "implement",
      origin: "human",
    });
    await waitFor(() => expect(statePicker).not.toHaveTextContent("…"));
    await waitFor(() => {
      expect(visibleWorkItemIds(stories)).toEqual([
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
      ]);
    });
  });

  it("[overhaul-60] keeps authoritative transition landing and explicit drag placement", async () => {
    const http = fixture();
    const grill = {
      id: "grill",
      name: "Grill",
      group: "backlog",
      color: null,
      sort_order: 2,
    };
    http.tree("module-1", {
      rootIds: ["picker-move", "drag-move", "ideas-top", "ideas-bottom"],
      children: {
        "picker-move": [],
        "drag-move": [],
        "ideas-top": [],
        "ideas-bottom": [],
      },
      order: ["picker-move", "drag-move", "ideas-top", "ideas-bottom"],
    });
    http.workItems([
      workItem({ id: "picker-move", name: "Picker move", state: grill, rank: "X" }),
      workItem({ id: "drag-move", name: "Drag move", key: "MEML-2", state: grill, rank: "W" }),
      workItem({ id: "ideas-top", name: "Ideas top", key: "MEML-3", rank: "M" }),
      workItem({ id: "ideas-bottom", name: "Ideas bottom", key: "MEML-4", rank: "Z" }),
    ]);
    // This seam supplies the authoritative transition response; rank
    // allocation itself is covered at the backend transition boundary.
    http.transitionRank("picker-move", "mV");
    http.transitionRank("drag-move", "tFV");
    mountStudio({ http, selectedTaskId: "picker-move" });

    const stories = await screen.findByRole("region", { name: "Stories" });
    const details = screen.getByRole("region", { name: "Details" });
    const pickerPatched = http.expectPatch("picker-move", {
      state_id: "state-1",
      origin: "human",
    });
    fireEvent.click(await within(details).findByRole("button", { name: "Grill" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ideas" }));
    await pickerPatched;

    const visibleIds = () => within(stories)
      .getAllByRole("treeitem")
      .map((row) => row.getAttribute("data-task-id"));
    await waitFor(() => expect(visibleIds()).toEqual([
      "__scratch__",
      "ideas-top",
      "ideas-bottom",
      "picker-move",
      "drag-move",
    ]));

    const dragged = within(stories).getByRole("treeitem", { name: /Drag move/ });
    const target = within(stories).getByRole("treeitem", { name: /Ideas bottom/ });
    const transitioned = http.expectPatch("drag-move", {
      state_id: "state-1",
      origin: "human",
    });
    const reordered = http.expectReorder("drag-move", {
      before_id: "ideas-top",
      after_id: "ideas-bottom",
    });
    dragWorkItem(dragged, target, "before");

    await transitioned;
    await reordered;
    await waitFor(() => expect(visibleIds()).toEqual([
      "__scratch__",
      "ideas-top",
      "drag-move",
      "ideas-bottom",
      "picker-move",
    ]));
  });
});
