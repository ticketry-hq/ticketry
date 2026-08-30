import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { dragEvent, dataTransfer } from "./moduleDragGestures";
import { fixture, mountStudio, workItem } from "./seam";

function storyRow(id: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-task-id="${id}"]`);
  if (!row) throw new Error(`Story row ${id} is not rendered.`);
  return row;
}

function layoutStoryRows(ids: readonly string[]): void {
  ids.forEach((id, index) => {
    const top = index * 20;
    Object.defineProperty(storyDropTarget(id), "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        top,
        bottom: top + 20,
        height: 20,
        left: 0,
        right: 200,
        width: 200,
      }),
    });
  });
}

function storyDropTarget(id: string): HTMLElement {
  const target = storyRow(id).parentElement?.parentElement;
  if (!(target instanceof HTMLElement)) {
    throw new Error(`Story drop target ${id} is not rendered.`);
  }
  return target;
}

describe("story list reorder acceptance", () => {
  it("[overhaul-181] reorders root tasks through the GraphQL write path", async () => {
    const http = fixture();
    const items = [
      workItem({ id: "story-a", name: "Story A", sequence_id: 1, rank: "a" }),
      workItem({ id: "story-b", name: "Story B", sequence_id: 2, rank: "b" }),
      workItem({ id: "story-c", name: "Story C", sequence_id: 3, rank: "c" }),
    ];
    http.tree("module-1", {
      rootIds: items.map((item) => item.id),
      children: Object.fromEntries(items.map((item) => [item.id, []])),
      order: items.map((item) => item.id),
    });
    http.workItems(items);
    mountStudio({ http });

    await screen.findByRole("treeitem", { name: /Story C/ });
    expect(
      Array.from(document.querySelectorAll<HTMLElement>("[data-task-id]"))
        .map((row) => row.dataset.taskId)
        .filter((id) => id?.startsWith("story-")),
    ).toEqual(["story-a", "story-b", "story-c"]);
    layoutStoryRows(items.map((item) => item.id));
    const transfer = dataTransfer();
    const source = storyRow("story-c");
    const target = storyDropTarget("story-a");

    dragEvent(source, "dragstart", transfer);
    dragEvent(target, "dragover", transfer, { clientY: 2 });
    dragEvent(target, "drop", transfer, { clientY: 2 });

    await expect(http.expectReorder("story-c", {
      before_id: null,
      after_id: "story-a",
    })).resolves.toBeUndefined();
    await waitFor(() => expect(
      Array.from(document.querySelectorAll<HTMLElement>("[data-task-id]"))
        .map((row) => row.dataset.taskId)
        .filter((id) => id?.startsWith("story-")),
    ).toEqual(["story-c", "story-a", "story-b"]));
  });

  it("[overhaul-182] sends a reorder when imported neighbors share a rank", async () => {
    const http = fixture();
    const items = [
      workItem({ id: "story-a", name: "Story A", sequence_id: 1, rank: "V" }),
      workItem({ id: "story-b", name: "Story B", sequence_id: 2, rank: "V" }),
      workItem({ id: "story-c", name: "Story C", sequence_id: 3, rank: "V" }),
    ];
    http.tree("module-1", {
      rootIds: items.map((item) => item.id),
      children: Object.fromEntries(items.map((item) => [item.id, []])),
      order: items.map((item) => item.id),
    });
    http.workItems(items);
    mountStudio({ http });

    await screen.findByRole("treeitem", { name: /Story C/ });
    const visibleIds = Array.from(
      document.querySelectorAll<HTMLElement>("[data-task-id]"),
    )
      .map((row) => row.dataset.taskId)
      .filter((id): id is string => Boolean(id?.startsWith("story-")));
    expect(visibleIds).toEqual(["story-c", "story-b", "story-a"]);
    layoutStoryRows(visibleIds);
    const transfer = dataTransfer();
    const source = storyRow("story-c");
    const target = storyDropTarget("story-b");

    dragEvent(source, "dragstart", transfer);
    dragEvent(target, "dragover", transfer, { clientY: 38 });
    dragEvent(target, "drop", transfer, { clientY: 38 });

    await waitFor(() => expect(http.reorderBodies("story-c")).toEqual([{
      before_id: "story-b",
      after_id: "story-a",
    }]));
    await waitFor(() => expect(
      Array.from(document.querySelectorAll<HTMLElement>("[data-task-id]"))
        .map((row) => row.dataset.taskId)
        .filter((id) => id?.startsWith("story-")),
    ).toEqual(["story-b", "story-c", "story-a"]));
  });
});
