import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { fixture, mountStudio, workItem } from "./seam";

describe("overhaul acceptance - Stories descendant chicklets", () => {
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
    const parent = await within(stories).findByRole("treeitem", {
      name: /Parent story/,
    });
    expect(parent).toHaveAttribute("aria-expanded", "false");
    expect(within(stories).queryByText("Implementation child")).toBeNull();

    http.notifications.runLifecycle(
      "run-child",
      "working",
      "2026-08-07T12:00:01Z",
    );
    act(() => {
      useAgentStatusStore.getState().upsertAutomationAttempt({
        attempt_id: "attempt-child",
        root_attempt_id: "attempt-child",
        retry_of_attempt_id: null,
        work_item_id: "child-1",
        status: "failed",
        error: "Provider exited before launch",
        failure: null,
        retryable: false,
        agent_run_id: "run-child",
        updated_at: "2026-08-07T12:00:02Z",
      });
    });

    expect(await within(parent).findByTestId("agent-state-badge"))
      .toHaveTextContent("▶1");
    expect(await within(parent).findByTestId("automation-failure-chicklet"))
      .toHaveTextContent("!1Fix required");

    fireEvent.click(
      within(parent).getByRole("button", { name: "Expand subtasks" }),
    );
    const child = await within(stories).findByRole("treeitem", {
      name: /Implementation child/,
    });
    http.notifications.runLifecycle(
      "run-child",
      "working",
      "2026-08-07T12:00:03Z",
    );

    await waitFor(() => {
      expect(within(parent).queryByTestId("agent-state-badge")).toBeNull();
      expect(within(parent).queryByTestId("automation-failure-chicklet"))
        .toBeNull();
    });
    expect(await within(child).findByTestId("agent-state-badge"))
      .toHaveTextContent("▶1");
    expect(await within(child).findByTestId("automation-failure-chicklet"))
      .toHaveTextContent("!1Fix required");
  });
});
