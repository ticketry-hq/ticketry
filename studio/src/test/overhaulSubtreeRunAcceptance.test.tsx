import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixture, mountStudio, workItem } from "./seam";

describe("overhaul acceptance — subtree execution", () => {
  it("[overhaul-21] repeats Run subtree to revive an inactive campaign", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: ["story-1"],
      children: { "story-1": ["child-1"], "child-1": [] },
      order: ["story-1", "child-1"],
    });
    http.workItems([
      workItem({
        id: "story-1",
        name: "Campaign root",
        sub_issues_count: 1,
      }),
      workItem({
        id: "child-1",
        name: "Implementation child",
        key: "MEML-2",
        parent_id: "story-1",
      }),
    ]);
    mountStudio({ http });

    const stories = await screen.findByRole("region", { name: "Stories" });
    fireEvent.click(
      within(stories).getByRole("treeitem", { name: /Campaign root/ }),
    );
    const details = screen.getByRole("region", { name: "Details" });
    const runSubtree = await within(details).findByRole("button", {
      name: "Run subtree",
    });

    fireEvent.click(runSubtree);
    await waitFor(() => expect(http.graphRunCount("story-1")).toBe(1));
    expect(runSubtree).toBeEnabled();

    fireEvent.click(runSubtree);
    await waitFor(() => expect(http.graphRunCount("story-1")).toBe(2));
    expect(runSubtree).toBeEnabled();
  });
});
