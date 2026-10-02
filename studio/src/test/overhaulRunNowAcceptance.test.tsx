import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { studioKeymapRegistry } from "../app/navigation/keymapRegistry";
import { useTerminalStore } from "../features/agents/terminal/appNavigation";
import { KeyboardSettingsPanel } from "../features/studio/modals/KeyboardSettingsPanel";
import { useClientStore } from "../state/clientStore";
import { fixture, mountStudio, workItem } from "./seam";

const ideas = {
  id: "ideas",
  name: "Ideas",
  group: "backlog",
  color: null,
};
const implement = {
  id: "implement",
  name: "Implement",
  group: "started",
  color: null,
};
const tickets = {
  id: "tickets",
  name: "Tickets",
  group: "unstarted",
  color: null,
};

function RunNowAcceptanceSurface() {
  useGlobalKeymap();
  return (
    <KeyboardSettingsPanel
      bindings={studioKeymapRegistry.getConfigurableBindings()}
      overridden={new Set()}
      recordingKey={null}
      message={null}
      saving={false}
      onRecord={vi.fn()}
      onReset={vi.fn()}
      onRestoreDefaults={vi.fn()}
    />
  );
}

function hasToast(kind: "success" | "error", text: string): boolean {
  return useClientStore
    .getState()
    .toasts.some((toast) => toast.kind === kind && toast.message.includes(text));
}

describe("overhaul acceptance — Run Now", () => {
  it("[overhaul-134] runs eligible Ideas from Details or r with one guarded request and follows workflow refreshes", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: [
        "click-idea",
        "key-idea",
        "refusal-idea",
        "refresh-idea",
        "ticketed-story",
        "implementation-idea",
      ],
      children: {
        "click-idea": [],
        "key-idea": [],
        "refusal-idea": [],
        "refresh-idea": [],
        "ticketed-story": [],
        "implementation-idea": [],
      },
      order: [
        "click-idea",
        "key-idea",
        "refusal-idea",
        "refresh-idea",
        "ticketed-story",
        "implementation-idea",
      ],
    });
    http.workItems([
      workItem({ id: "click-idea", name: "Click idea", state: ideas }),
      workItem({ id: "key-idea", name: "Keyboard idea", state: ideas }),
      workItem({ id: "refusal-idea", name: "Refusal idea", state: ideas }),
      workItem({ id: "refresh-idea", name: "Refresh idea", state: ideas }),
      workItem({ id: "ticketed-story", name: "Ticketed story", state: tickets }),
      workItem({
        id: "implementation-idea",
        name: "Implementation idea",
        state: ideas,
        issue_type: {
          id: "implementation",
          name: "Implementation",
          level: "task",
          color: null,
          sort_order: 2,
        },
      }),
      workItem({ id: "state-catalog", name: "State catalog", state: implement }),
    ]);
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    mountStudio({
      http,
      selectedTaskId: "click-idea",
      children: <RunNowAcceptanceSurface />,
      graphQlExecution: true,
    });

    const details = await screen.findByRole("region", { name: "Details" });
    const runNow = await within(details).findByRole("button", { name: "Run now" });
    expect(runNow).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("button", {
      name: "Run now, current shortcut R, change binding",
    }))
      .toHaveTextContent("R");

    const release = http.holdRunNow();
    fireEvent.click(runNow);
    fireEvent.click(runNow);
    await waitFor(() => expect(http.runNowCount("click-idea")).toBe(1));
    expect(runNow).toBeDisabled();
    expect(runNow).toHaveAttribute("aria-busy", "true");
    expect(runNow).toHaveTextContent("Running now…");
    release();

    await waitFor(() =>
      expect(useClientStore.getState().workspaces["click-idea"]?.active)
        .toBe("terminal"),
    );
    expect(useTerminalStore.getState().sessionByRun["run-now-click-idea"])
      .toBeTruthy();
    expect(hasToast("success", "Run now started.")).toBe(true);

    useClientStore.getState().selectTask("key-idea");
    await within(details).findByRole("button", { name: "Run now" });
    fireEvent.keyDown(window, { key: "r" });
    await waitFor(() =>
      expect(useClientStore.getState().workspaces["key-idea"]?.active)
        .toBe("terminal"),
    );
    expect(http.runNowCount("key-idea")).toBe(1);

    useClientStore.getState().selectTask("refusal-idea");
    const refusalRunNow = await within(details).findByRole("button", { name: "Run now" });
    http.failNextRunNow(409, {
      target_id: "refusal-idea",
      committed_state: null,
      run: null,
      code: "required_skill_unavailable",
      detail: "The required skill is not packaged.",
      remedy: "Choose a packaged skill, then retry.",
    });
    fireEvent.click(refusalRunNow);
    await waitFor(() =>
      expect(hasToast(
        "error",
        "The required skill is not packaged. "
          + "Next action: Choose a packaged skill, then retry.",
      )).toBe(true),
    );
    expect(useClientStore.getState().workspaces["refusal-idea"]?.active)
      .not.toBe("terminal");

    http.failNextRunNow(422, {
      target_id: "refusal-idea",
      committed_state: null,
      run: null,
      detail: "binding_not_configured",
      code: "binding_not_configured",
    });
    fireEvent.click(refusalRunNow);
    await waitFor(() =>
      expect(hasToast(
        "error",
        "Configure the Implementation launch binding for Implement before trying again.",
      )).toBe(true),
    );
    expect(http.runNowCount("refusal-idea")).toBe(2);

    http.failNextRunNow(422, {
      target_id: "refusal-idea",
      committed_state: null,
      run: null,
      code: "no_activated_providers",
      detail: "No activated providers are configured.",
      remedy: "Activate a provider.",
    });
    fireEvent.click(refusalRunNow);
    await waitFor(() => expect(hasToast(
      "error",
      "To run agent work, activate a provider in Settings > Model configuration. "
        + "You can keep planning without one.",
    )).toBe(true));
    expect(within(details).getByRole("button", { name: "Run now" })).toBeVisible();
    expect(useClientStore.getState().workspaces["refusal-idea"]?.active)
      .not.toBe("terminal");

    http.failNextRunNow(503, {
      target_id: "refusal-idea",
      committed_state: { id: "implement", name: "Implement" },
      run: null,
      detail: "launch_unavailable",
      code: "launch_unavailable",
    });
    fireEvent.click(refusalRunNow);
    await waitFor(() =>
      expect(within(details).queryByRole("button", { name: "Run now" }))
        .toBeNull(),
    );
    expect(http.runNowCount("refusal-idea")).toBe(4);

    useClientStore.getState().selectTask("ticketed-story");
    await waitFor(() =>
      expect(within(details).queryByRole("button", { name: "Run now" }))
        .toBeNull(),
    );
    fireEvent.keyDown(window, { key: "r" });
    expect(http.runNowCount("ticketed-story")).toBe(0);

    useClientStore.getState().selectTask("implementation-idea");
    await waitFor(() =>
      expect(within(details).queryByRole("button", { name: "Run now" }))
        .toBeNull(),
    );
    fireEvent.keyDown(window, { key: "r" });
    expect(http.runNowCount("implementation-idea")).toBe(0);

    useClientStore.getState().selectTask("refresh-idea");
    await within(details).findByRole("button", { name: "Run now" });
    http.setRunNowTransitionEnabled(false);
    await http.refreshRunNowCapabilities("story");
    await waitFor(() =>
      expect(within(details).queryByRole("button", { name: "Run now" }))
        .toBeNull(),
    );
    fireEvent.keyDown(window, { key: "r" });
    expect(http.runNowCount("refresh-idea")).toBe(0);
  });

  it("[overhaul-400] hides Run now and ignores r for Stories with any child, and explains a subtasks refusal", async () => {
    const http = fixture();
    const done = { id: "done", name: "Done", group: "completed", color: null };
    http.tree("module-1", {
      rootIds: [
        "active-parent",
        "completed-parent",
        "archived-parent",
        "childless-story",
        "stale-story",
      ],
      children: {
        "active-parent": ["active-child"],
        "completed-parent": ["completed-child"],
        "archived-parent": ["archived-child"],
        "active-child": [],
        "completed-child": [],
        "archived-child": [],
        "childless-story": [],
        "stale-story": [],
      },
      order: [
        "active-parent",
        "active-child",
        "completed-parent",
        "completed-child",
        "archived-parent",
        "archived-child",
        "childless-story",
        "stale-story",
      ],
    });
    http.workItems([
      workItem({ id: "active-parent", name: "Active parent", state: ideas }),
      workItem({
        id: "active-child",
        name: "Active child",
        state: ideas,
        parent_id: "active-parent",
      }),
      workItem({ id: "completed-parent", name: "Completed parent", state: ideas }),
      workItem({
        id: "completed-child",
        name: "Completed child",
        state: done,
        parent_id: "completed-parent",
      }),
      workItem({ id: "archived-parent", name: "Archived parent", state: ideas }),
      workItem({
        id: "archived-child",
        name: "Archived child",
        state: ideas,
        parent_id: "archived-parent",
        is_archived: true,
      }),
      workItem({ id: "childless-story", name: "Childless story", state: ideas }),
      workItem({ id: "stale-story", name: "Stale story", state: ideas }),
      workItem({ id: "state-catalog", name: "State catalog", state: implement }),
    ]);
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    mountStudio({
      http,
      selectedTaskId: "childless-story",
      children: <RunNowAcceptanceSurface />,
      graphQlExecution: true,
    });

    const details = await screen.findByRole("region", { name: "Details" });
    await within(details).findByRole("button", { name: "Run now" });

    for (const id of ["active-parent", "completed-parent", "archived-parent"]) {
      useClientStore.getState().selectTask(id);
      await waitFor(() =>
        expect(within(details).queryByRole("button", { name: "Run now" }))
          .toBeNull(),
      );
      fireEvent.keyDown(window, { key: "r" });
      expect(http.runNowCount(id)).toBe(0);
    }

    useClientStore.getState().selectTask("stale-story");
    const staleRunNow = await within(details).findByRole("button", { name: "Run now" });
    http.failNextRunNow(409, {
      target_id: "stale-story",
      committed_state: null,
      run: null,
      code: "story_has_subtasks",
      detail: "The Story has subtasks; Run Now is unavailable.",
      remedy: null,
    });
    fireEvent.click(staleRunNow);
    await waitFor(() =>
      expect(hasToast(
        "error",
        "Run now could not be started: This Story has subtasks, so it cannot Run now.",
      )).toBe(true),
    );
    expect(http.runNowCount("stale-story")).toBe(1);
    expect(useClientStore.getState().workspaces["stale-story"]?.active)
      .not.toBe("terminal");
  });

  it("[overhaul-401] converts the same Story to Implementation in Implement from the button, r, and a committed late-launch failure", async () => {
    const http = fixture();
    const implementation = {
      id: "implementation",
      name: "Implementation",
      level: "task" as const,
      color: null,
      sort_order: 2,
    };
    const rootIds = [
      "click-story",
      "key-story",
      "late-story",
      "unconfigured-story",
      "implementation-catalog",
    ];
    http.tree("module-1", {
      rootIds,
      children: Object.fromEntries(rootIds.map((id) => [id, []])),
      order: rootIds,
    });
    http.workItems([
      workItem({ id: "click-story", name: "Click story", key: "MEML-11", sequence_id: 11, state: ideas }),
      workItem({ id: "key-story", name: "Keyboard story", key: "MEML-12", sequence_id: 12, state: ideas }),
      workItem({ id: "late-story", name: "Late story", key: "MEML-13", sequence_id: 13, state: ideas }),
      workItem({ id: "unconfigured-story", name: "Unconfigured story", state: ideas }),
      workItem({
        id: "implementation-catalog",
        name: "Implementation catalog",
        state: implement,
        issue_type: implementation,
      }),
    ]);
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    mountStudio({
      http,
      selectedTaskId: "click-story",
      children: <RunNowAcceptanceSurface />,
      graphQlExecution: true,
    });

    const details = await screen.findByRole("region", { name: "Details" });
    const stories = await screen.findByRole("region", { name: "Stories" });
    const typeLabel = () =>
      within(within(details).getByTestId("issue-type-picker")).getByRole("button");
    const stateLabel = () =>
      within(within(details).getByTestId("state-picker")).getByRole("button");
    const expectConverted = async (id: string, name: string, sequenceId: number) => {
      await waitFor(() => expect(typeLabel()).toHaveTextContent("Implementation"));
      await waitFor(() => expect(stateLabel()).toHaveTextContent("Implement"));
      expect(within(details).queryByRole("button", { name: "Run now" })).toBeNull();
      expect(within(details).queryByRole("button", { name: "Story workflow guide" }))
        .toBeNull();
      expect(details).toHaveTextContent(name);
      expect(useClientStore.getState().selectedTaskId).toBe(id);
      expect(http.items.get(id)).toMatchObject({
        id,
        name,
        key: `MEML-${sequenceId}`,
        issue_type: "implementation",
        state: "implement",
      });
      // The Stories list regroups the same row under Implement without a reload.
      const row = within(stories).getByRole("treeitem", { name: new RegExp(name) });
      expect(row).toHaveTextContent(`T-${sequenceId}`);
      fireEvent.click(within(stories).getByRole("button", { name: "Collapse Implement" }));
      await waitFor(() =>
        expect(within(stories).queryByRole("treeitem", { name: new RegExp(name) }))
          .toBeNull(),
      );
      fireEvent.click(within(stories).getByRole("button", { name: "Expand Implement" }));
      await within(stories).findByRole("treeitem", { name: new RegExp(name) });
    };

    await waitFor(() => expect(typeLabel()).toHaveTextContent("Story"));
    fireEvent.click(await within(details).findByRole("button", { name: "Run now" }));
    await expectConverted("click-story", "Click story", 11);
    expect(hasToast("success", "Converted to Implementation in Implement. Run now started."))
      .toBe(true);

    useClientStore.getState().selectTask("key-story");
    await within(details).findByRole("button", { name: "Run now" });
    fireEvent.keyDown(window, { key: "r" });
    await expectConverted("key-story", "Keyboard story", 12);
    expect(http.runNowCount("key-story")).toBe(1);

    useClientStore.getState().selectTask("late-story");
    const lateRunNow = await within(details).findByRole("button", { name: "Run now" });
    http.failNextRunNow(503, {
      target_id: "late-story",
      committed_state: { id: "implement", name: "Implement" },
      committed_issue_type: { id: "implementation", name: "Implementation" },
      run: null,
      detail: "The agent could not launch.",
      code: "launch_unavailable",
      remedy: "Retry from Implement.",
    });
    fireEvent.click(lateRunNow);
    await expectConverted("late-story", "Late story", 13);
    expect(hasToast(
      "error",
      "It is now Implementation in Implement.",
    )).toBe(true);
    expect(useClientStore.getState().workspaces["late-story"]?.active)
      .not.toBe("terminal");
    expect(http.runNowCount("late-story")).toBe(1);

    useClientStore.getState().selectTask("unconfigured-story");
    const unconfiguredRunNow = await within(details).findByRole("button", { name: "Run now" });
    http.failNextRunNow(422, {
      target_id: "unconfigured-story",
      committed_state: null,
      committed_issue_type: null,
      run: null,
      detail: "No Implementation issue type includes Implement.",
      code: "implementation_not_configured",
      remedy: null,
    });
    fireEvent.click(unconfiguredRunNow);
    await waitFor(() => expect(hasToast(
      "error",
      "Run now could not be started: Add an Implementation issue type whose "
        + "workflow includes Implement before trying again.",
    )).toBe(true));
    expect(typeLabel()).toHaveTextContent("Story");
    expect(within(details).getByRole("button", { name: "Run now" })).toBeVisible();
  });
});
