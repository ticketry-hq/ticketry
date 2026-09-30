import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SelectedTicket } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicket";
import { fixture, mountStudio, workItem } from "./seam";

const TASK_ID = "long-details-task";

describe("overhaul acceptance - workspace scrolling", () => {
  it("[overhaul-258] keeps long Details content under one workspace scroll owner", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: [TASK_ID],
      children: { [TASK_ID]: [] },
      order: [TASK_ID],
    });
    http.workItems([
      workItem({
        id: TASK_ID,
        name: "Scroll long Details",
        parent_id: "module-1",
        sequence_id: 1477,
        description: Array.from(
          { length: 80 },
          (_, index) => `Details paragraph ${index + 1}`,
        ).join("\n\n"),
      }),
    ]);

    mountStudio({
      http,
      selectedTaskId: TASK_ID,
      children: <SelectedTicket />,
    });

    const surface = await screen.findByTestId("workspace-details-surface");
    const pane = surface.closest<HTMLElement>(
      '[data-pane="details-or-terminal"]',
    );
    expect(pane).not.toBeNull();

    const details = await within(surface).findByRole("region", {
      name: "Details",
    });
    const lastParagraph = await within(details).findByText(
      "Details paragraph 80",
      {},
      { timeout: 5_000 },
    );
    const declaredVerticalOwnersThroughPane = (node: HTMLElement) => {
      const owners: HTMLElement[] = [];
      for (
        let candidate: HTMLElement | null = node;
        candidate;
        candidate = candidate.parentElement
      ) {
        if (
          [
            "overflow-auto",
            "overflow-y-auto",
            "overflow-scroll",
            "overflow-y-scroll",
          ].some((className) => candidate.classList.contains(className))
        ) {
          owners.push(candidate);
        }
        if (candidate === pane) break;
      }
      return owners;
    };

    expect(lastParagraph).toBeVisible();
    expect(surface).toContainElement(lastParagraph);
    expect(declaredVerticalOwnersThroughPane(surface)).toEqual([surface]);
  }, 15_000);
});
