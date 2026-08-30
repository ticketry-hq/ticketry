import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { studioApolloClient } from "../shared/apollo/client";
import { fixture, mountStudio, workItem } from "./seam";

type Counts = Record<string, number>;

const profileGlobal = globalThis as typeof globalThis & {
  __ticketrySelectionProfileProbe?: (point: string) => void;
};

afterEach(() => {
  delete profileGlobal.__ticketrySelectionProfileProbe;
});

describe("overhaul acceptance — Stories row isolation", () => {
  it("[overhaul-204] updates only rows affected by a record or selection change", async () => {
    const http = fixture();
    const ids = ["story-1", "story-2", "story-3"];
    http.tree("module-1", {
      rootIds: ids,
      children: Object.fromEntries(ids.map((id) => [id, []])),
      order: ids,
    });
    http.workItems(ids.map((id, index) => workItem({
      id,
      name: `Story ${index + 1}`,
      sequence_id: index + 1,
      rank: String(index),
    })));

    const counts: Counts = {};
    profileGlobal.__ticketrySelectionProfileProbe = (point) => {
      counts[point] = (counts[point] ?? 0) + 1;
    };

    mountStudio({ http, selectedTaskId: ids[0] });
    const stories = await screen.findByRole("region", { name: "Stories" });
    const target = await within(stories).findByRole("treeitem", {
      name: /Story 3/,
    });
    for (const point of Object.keys(counts)) counts[point] = 0;

    act(() => {
      const cache = studioApolloClient().cache;
      cache.modify({
        id: cache.identify({ __typename: "WorktrackerIssue", id: "story-2" }),
        fields: { name: () => "Renamed story" },
      });
    });

    await waitFor(() => {
      expect(within(stories).getByText("Renamed story")).toBeVisible();
    });
    expect(counts["task-row-render"]).toBe(1);

    for (const point of Object.keys(counts)) counts[point] = 0;
    fireEvent.click(target);

    expect(target).toHaveAttribute("aria-selected", "true");
    expect(counts["task-row-render"]).toBe(2);
    expect(counts["tasks-pane-render"] ?? 0).toBe(0);
    expect(counts["visible-rows-build"] ?? 0).toBe(0);
  });
});
