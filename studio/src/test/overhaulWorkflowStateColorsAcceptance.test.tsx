import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { State } from "../shared/api/types";
import { fixture, mountStudio, workItem } from "./seam";

describe("overhaul acceptance — workflow-state colors", () => {
  it("[overhaul-142] separates Ideas, Grill, and Review with gray, red, and teal", async () => {
    const http = fixture();
    const states: Array<State & { sequenceId: number }> = [
      {
        id: "ideas",
        name: "Ideas",
        group: "backlog",
        color: "#60646C",
        sort_order: 0,
        sequenceId: 1,
      },
      {
        id: "grill",
        name: "Grill",
        group: "backlog",
        color: "#FA4D56",
        sort_order: 1,
        sequenceId: 2,
      },
      {
        id: "review",
        name: "Review",
        group: "started",
        color: "#08BDBA",
        sort_order: 5,
        sequenceId: 3,
      },
    ];
    http.tree("module-1", {
      rootIds: ["ideas-item", "grill-item", "review-item"],
      children: { "ideas-item": [], "grill-item": [], "review-item": [] },
      order: ["ideas-item", "grill-item", "review-item"],
    });
    http.workItems(
      states.map((state) =>
        workItem({
          id: `${state.id}-item`,
          name: `${state.name} work`,
          key: `MEML-${state.sequenceId}`,
          sequence_id: state.sequenceId,
          state,
        }),
      ),
    );

    mountStudio({ http });
    const stories = await screen.findByRole("region", { name: "Stories" });

    for (const state of states) {
      expect(
        within(stories)
          .getByRole("button", { name: `Collapse ${state.name}` })
          .querySelector(`[data-stage-icon="${state.name}"]`),
      ).toHaveStyle({ color: state.color });
      expect(within(stories).getByText(`T-${state.sequenceId}`))
        .toHaveStyle({ color: state.color });
    }
  });
});
