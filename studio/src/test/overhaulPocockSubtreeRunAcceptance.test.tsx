import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { globalShortcutLabel } from "../app/navigation/useGlobalShortcutLabel";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { EDITION, editionHas } from "../shared/config/edition";
import { useClientStore } from "../state/clientStore";
import { mountStudio } from "./seam";
import {
  campaignFixture,
  hasToast,
  NormalRunShortcutSurface,
} from "./subtreeRunCampaignFixture";

describe("Pocock acceptance — serial-only subtree execution", () => {
  it("compiles the Pocock edition without parallel subtree runs", () => {
    expect(EDITION).toBe("pocock");
    expect(editionHas("parallelSubtreeRuns")).toBe(false);
  });

  it("offers only Run subtree serially on a branch and routes Cmd+Enter to it", async () => {
    const http = campaignFixture();
    mountStudio({
      http,
      selectedTaskId: "story-1",
      children: <NormalRunShortcutSurface />,
      graphQlExecution: true,
    });

    const details = await screen.findByRole("region", { name: "Details" });
    const runSerially = await within(details).findByRole("button", {
      name: "Run subtree serially",
    });
    expect(within(details).queryByRole("button", { name: "Run subtree" })).toBeNull();
    // The serial action inherits the normal-run shortcut hint.
    const shortcut = globalShortcutLabel("normal-run-command");
    expect(shortcut).toBeTruthy();
    expect(runSerially).toHaveTextContent(`Run subtree serially${shortcut}`);

    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() => expect(http.graphRunCount("story-1")).toBe(1));
    expect(http.graphRunModes("story-1")).toEqual(["serial"]);
    await waitFor(() =>
      expect(hasToast("success", "Serial subtree run started.")).toBe(true),
    );

    fireEvent.click(runSerially);
    await waitFor(() => expect(http.graphRunCount("story-1")).toBe(2));
    expect(http.graphRunModes("story-1")).toEqual(["serial", "serial"]);
    expect(http.graphRunCount("branch-1")).toBe(0);
    expect(http.runNowCount("story-1")).toBe(0);

    // A leaf keeps its own direct run; it never becomes a campaign.
    useClientStore.getState().selectTask("child-1");
    await within(details).findByRole("button", { name: "Run item" });
    expect(
      within(details).queryByRole("button", { name: "Run subtree serially" }),
    ).toBeNull();
    expect(within(details).queryByRole("button", { name: "Run subtree" })).toBeNull();
  });

  it("keeps Open subtree run during an active run and starts nothing from Cmd+Enter", async () => {
    const http = campaignFixture();
    http.persistGraphRun("story-1", "2026-09-21T10:00:00Z");
    mountStudio({
      http,
      selectedTaskId: "story-1",
      children: <NormalRunShortcutSurface />,
      graphQlExecution: true,
    });
    useAgentStatusStore.getState().upsertRun({
      agent_run_id: "campaign-child-run",
      project_id: "project-1",
      task_id: "branch-1",
      module_id: "module-1",
      agent: "codex",
      scope: "task",
      started_at: "2026-09-21T10:00:01Z",
      state: "working",
      effective_state: "working",
      updated_at: "2026-09-21T10:00:02Z",
    });

    const details = await screen.findByRole("region", { name: "Details" });
    expect(
      await within(details).findByRole("button", { name: "Open subtree run" }),
    ).toBeVisible();
    expect(within(details).queryByRole("button", { name: "Run subtree" })).toBeNull();
    expect(
      within(details).queryByRole("button", { name: "Run subtree serially" }),
    ).toBeNull();
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(http.graphRunCount("story-1")).toBe(0);

    useAgentStatusStore.getState().applyState(
      "campaign-child-run",
      "exited",
      "2026-09-21T10:01:00Z",
    );
    expect(
      await within(details).findByRole("button", { name: "Run subtree serially" }),
    ).toBeEnabled();
    expect(within(details).queryByRole("button", { name: "Run subtree" })).toBeNull();
    expect(
      within(details).queryByRole("button", { name: "Open subtree run" }),
    ).toBeNull();
  });
});
