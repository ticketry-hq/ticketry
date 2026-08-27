import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixture, mountStudio, workItem } from "./seam";
import { useClientStore } from "../state/clientStore";

function hasToast(kind: "success" | "error", text: string): boolean {
  return useClientStore
    .getState()
    .toasts.some((toast) => toast.kind === kind && toast.message.includes(text));
}

function campaignFixture() {
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
  return http;
}

async function openCampaignDetails(): Promise<HTMLElement> {
  const stories = await screen.findByRole("region", { name: "Stories" });
  fireEvent.click(
    await within(stories).findByRole("treeitem", { name: /Campaign root/ }),
  );
  const details = screen.getByRole("region", { name: "Details" });
  await within(details).findByRole("button", { name: "Run subtree" });
  return details;
}

describe("overhaul acceptance — subtree execution", () => {
  it("[overhaul-21] repeats Run subtree to revive an inactive campaign", async () => {
    const http = campaignFixture();
    mountStudio({ http, graphQlExecution: true });

    const details = await openCampaignDetails();
    const runSubtree = within(details).getByRole("button", {
      name: "Run subtree",
    });

    fireEvent.click(runSubtree);
    await waitFor(() => expect(http.graphRunCount("story-1")).toBe(1));
    expect(runSubtree).toBeEnabled();

    fireEvent.click(runSubtree);
    await waitFor(() => expect(http.graphRunCount("story-1")).toBe(2));
    expect(runSubtree).toBeEnabled();

    // Run subtree keeps the historical parallel campaign by omitting the mode.
    expect(http.graphRunModes("story-1")).toEqual([null, null]);
  });

  it("[overhaul-57] runs a subtree serially beside the parallel action under one capability", async () => {
    const http = campaignFixture();
    mountStudio({ http, graphQlExecution: true });

    const details = await openCampaignDetails();
    const runSubtree = within(details).getByRole("button", {
      name: "Run subtree",
    });
    const runSerially = within(details).getByRole("button", {
      name: "Run serially",
    });

    // Each control keeps its own in-flight guard: only the invoked action
    // reports pending while its request is outstanding.
    const release = http.holdGraphRuns();
    fireEvent.click(runSerially);
    await waitFor(() => expect(runSerially).toBeDisabled());
    expect(runSerially).toHaveAttribute("aria-busy", "true");
    expect(runSerially).toHaveTextContent("Running serially…");
    expect(runSubtree).toBeEnabled();
    expect(runSubtree).toHaveAttribute("aria-busy", "false");
    release();

    await waitFor(() => expect(runSerially).toBeEnabled());
    expect(http.graphRunModes("story-1")).toEqual(["serial"]);
    await waitFor(() =>
      expect(hasToast("success", "Serial subtree run started.")).toBe(true),
    );

    // The parallel action stays available and keeps its own request mode.
    fireEvent.click(runSubtree);
    await waitFor(() => expect(http.graphRunCount("story-1")).toBe(2));
    expect(http.graphRunModes("story-1")).toEqual(["serial", null]);
    await waitFor(() =>
      expect(hasToast("success", "Subtree run started.")).toBe(true),
    );

    // An accepted press that launches nothing says so from either control
    // instead of claiming a run started.
    http.nextGraphRunLaunchesNothing();
    fireEvent.click(runSubtree);
    await waitFor(() =>
      expect(hasToast("error", "Subtree run started nothing")).toBe(true),
    );

    http.nextGraphRunLaunchesNothing();
    fireEvent.click(runSerially);
    await waitFor(() =>
      expect(hasToast("error", "Serial subtree run started nothing")).toBe(true),
    );

    // A refused serial request reports the backend failure rather than
    // claiming that work launched.
    http.failNextGraphRun(409, { detail: "A campaign is already live." });
    fireEvent.click(runSerially);
    await waitFor(() =>
      expect(
        hasToast("error", "Serial subtree execution could not be started"),
      ).toBe(true),
    );

    // A stale capability refresh removes both actions together.
    http.setSubtreeRunEnabled(false);
    http.failNextGraphRun(403, { error: "subtree_run_not_enabled" });
    fireEvent.click(runSerially);
    await waitFor(() =>
      expect(
        within(details).queryByRole("button", { name: "Run serially" }),
      ).toBeNull(),
    );
    await waitFor(() =>
      expect(hasToast("error", "is no longer available")).toBe(true),
    );
    expect(
      within(details).queryByRole("button", { name: "Run subtree" }),
    ).toBeNull();
  });
});
