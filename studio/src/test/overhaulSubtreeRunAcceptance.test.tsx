import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { useModalStore } from "../app/modal/modalStore";
import { TEMP_TASK_ID } from "../features/agents/types";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { fixture, mountStudio, workItem } from "./seam";
import { useClientStore } from "../state/clientStore";
import { useAgentStatusStore } from "../features/agents/status/testStore";

function NormalRunShortcutSurface() {
  useGlobalKeymap();
  return (
    <>
      <input aria-label="Typing target" />
      <textarea
        aria-label="Prompt target"
        onKeyDown={(event) => event.preventDefault()}
      />
      <select aria-label="Select target" />
      <div aria-label="Editor target" contentEditable />
      <button
        type="button"
        onKeyDown={(event) => event.preventDefault()}
      >
        Local Cmd+Enter
      </button>
    </>
  );
}

function hasToast(kind: "success" | "error", text: string): boolean {
  return useClientStore
    .getState()
    .toasts.some((toast) => toast.kind === kind && toast.message.includes(text));
}

function campaignFixture() {
  const http = fixture();
  http.tree("module-1", {
    rootIds: ["story-1"],
    children: {
      "story-1": ["branch-1"],
      "branch-1": ["child-1"],
      "child-1": [],
    },
    order: ["story-1", "branch-1", "child-1"],
  });
  http.workItems([
    workItem({
      id: "story-1",
      name: "Campaign root",
      sub_issues_count: 1,
    }),
    workItem({
      id: "branch-1",
      name: "Nested branch",
      key: "MEML-2",
      parent_id: "story-1",
      sub_issues_count: 1,
    }),
    workItem({
      id: "child-1",
      name: "Implementation child",
      key: "MEML-3",
      parent_id: "branch-1",
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
  it("routes guarded Cmd+Enter through the selected item's normal play command", async () => {
    const http = campaignFixture();
    useModalStore.setState({ modalStack: [] });
    let leafLaunches = 0;
    let releaseLeaf!: () => void;
    const leafGate = new Promise<void>((resolve) => {
      releaseLeaf = resolve;
    });
    mountStudio({
      http,
      selectedTaskId: "child-1",
      children: <NormalRunShortcutSurface />,
      graphQlExecution: true,
      graphQlExecute: async (document, variables) => {
        if (documentOperationName(document) === "CreateTerminalSession") {
          leafLaunches += 1;
          await leafGate;
          return {
            terminal_session: {
              __typename: "AgentTerminalSessions",
              agent_run_id: "leaf-run-1",
              module_id: "module-1",
              scope: "task",
              doc_rel_path: null,
              created_at: "2026-09-16T00:00:00Z",
              agent_run: {
                __typename: "AgentRuns",
                id: "leaf-run-1",
                agent: "codex",
                launch_state: "state-1",
                launch_model: null,
              },
            },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const details = await screen.findByRole("region", { name: "Details" });
    const runItem = await within(details).findByRole("button", {
      name: "Run item",
    });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    fireEvent.click(runItem);
    await waitFor(() => expect(leafLaunches).toBe(1));
    expect(runItem).toBeDisabled();
    releaseLeaf();
    await waitFor(() => expect(runItem).toBeEnabled());

    useClientStore.getState().selectTask("branch-1");
    const runSubtree = await within(details).findByRole("button", {
      name: "Run subtree",
    });
    const releaseBranch = http.holdGraphRuns();
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    fireEvent.click(runSubtree);
    await waitFor(() => expect(http.graphRunCount("branch-1")).toBe(1));
    expect(runSubtree).toBeDisabled();
    releaseBranch();
    await waitFor(() => expect(runSubtree).toBeEnabled());
    fireEvent.click(runSubtree);
    await waitFor(() => expect(http.graphRunCount("branch-1")).toBe(2));
    expect(http.graphRunCount("story-1")).toBe(0);
    expect(http.runNowCount("branch-1")).toBe(0);
    expect(useModalStore.getState().modalStack).toEqual([]);

    const guardedCount = http.graphRunCount("branch-1");
    for (const target of [
      screen.getByLabelText("Typing target"),
      screen.getByLabelText("Prompt target"),
      screen.getByLabelText("Select target"),
      screen.getByLabelText("Editor target"),
      screen.getByRole("button", { name: "Local Cmd+Enter" }),
    ]) {
      fireEvent.keyDown(target, { key: "Enter", metaKey: true });
    }
    const handled = new KeyboardEvent("keydown", {
      key: "Enter",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    handled.preventDefault();
    window.dispatchEvent(handled);
    useModalStore.setState({ modalStack: [{ type: "settings" }] });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    useModalStore.setState({ modalStack: [] });
    expect(http.graphRunCount("branch-1")).toBe(guardedCount);

    http.nextGraphRunLaunchesNothing();
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() =>
      expect(hasToast("error", "Subtree run started nothing")).toBe(true),
    );
    http.failNextGraphRun(409, { detail: "A campaign is already live." });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() =>
      expect(hasToast("error", "Subtree execution could not be started")).toBe(true),
    );
    http.setSubtreeRunEnabled(false);
    http.failNextGraphRun(403, { error: "subtree_run_not_enabled" });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() => expect(runSubtree).toBeDisabled());
    const refusedCount = http.graphRunCount("branch-1");
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(http.graphRunCount("branch-1")).toBe(refusedCount);

    useClientStore.setState({ selectedTaskId: null });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    useClientStore.setState({ selectedTaskId: TEMP_TASK_ID });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(http.graphRunCount("branch-1")).toBe(refusedCount);
    expect(leafLaunches).toBe(1);
  });

  it("routes normal play by the selected work item's shape", async () => {
    const http = campaignFixture();
    const directLaunches: Array<Record<string, unknown>> = [];
    mountStudio({
      http,
      selectedTaskId: "child-1",
      graphQlExecution: true,
      graphQlExecute: async (document, variables) => {
        if (documentOperationName(document) === "CreateTerminalSession") {
          directLaunches.push(variables as Record<string, unknown>);
          return {
            terminal_session: {
              __typename: "AgentTerminalSessions",
              agent_run_id: "branch-run-1",
              module_id: "module-1",
              scope: "task",
              doc_rel_path: null,
              created_at: "2026-09-16T00:00:00Z",
              agent_run: {
                __typename: "AgentRuns",
                id: "branch-run-1",
                agent: "codex",
                launch_state: "state-1",
                launch_model: null,
              },
            },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const details = await screen.findByRole("region", { name: "Details" });
    await within(details).findByRole("button", { name: "Run item" });
    expect(within(details).queryByRole("button", { name: "Run agent" })).toBeNull();
    expect(
      within(details).queryByRole("button", { name: "Run subtree serially" }),
    ).toBeNull();

    const stories = await screen.findByRole("region", { name: "Stories" });
    const root = await within(stories).findByRole("treeitem", {
      name: /Campaign root/,
    });
    fireEvent.click(within(root).getByRole("button", { name: "Expand subtasks" }));
    fireEvent.click(
      await within(stories).findByRole("treeitem", { name: /Nested branch/ }),
    );
    const runSubtree = await within(details).findByRole("button", {
      name: "Run subtree",
    });
    const runSerially = within(details).getByRole("button", {
      name: "Run subtree serially",
    });
    const runItem = within(details).getByRole("button", { name: "Run item" });
    expect(runSubtree).toHaveAttribute("title", "Run subtree");
    expect(runSerially).toHaveAttribute("title", "Run subtree serially");
    const statusRow = screen.getByTestId("status-row");
    const statusButtons = within(statusRow).getAllByRole("button");
    expect(statusButtons.indexOf(runSubtree)).toBeLessThan(
      statusButtons.indexOf(runSerially),
    );
    expect(statusButtons.indexOf(runSerially)).toBeLessThan(
      statusButtons.indexOf(runItem),
    );
    expect(statusRow.lastElementChild).toBe(runItem);
    expect(within(details).queryByRole("button", { name: "Run agent" })).toBeNull();

    fireEvent.click(runItem);
    await waitFor(() => expect(directLaunches).toHaveLength(1));
    expect(directLaunches[0]).toMatchObject({
      issueId: "branch-1",
      targetId: "branch-1",
      moduleId: "module-1",
      kind: "task",
    });
    expect(http.graphRunCount("branch-1")).toBe(0);
    expect(http.graphRunCount("story-1")).toBe(0);
    expect(http.graphRunCount("child-1")).toBe(0);
    expect(http.runNowCount("branch-1")).toBe(0);
  });

  it("hides direct play on a branch without a launch binding", async () => {
    const http = campaignFixture();
    mountStudio({
      http,
      selectedTaskId: "branch-1",
      graphQlExecution: true,
      graphQlExecute: async (document, variables) => {
        const result = await http.executeGraphQl(document, variables);
        if (documentOperationName(document) !== "WorkTrackerProjectOpen") {
          return result;
        }
        const projectOpen = result as {
          issue_types: {
            nodes: Array<{ launch_bindings: { nodes: unknown[] } }>;
          };
        };
        return {
          ...projectOpen,
          issue_types: {
            ...projectOpen.issue_types,
            nodes: projectOpen.issue_types.nodes.map((issueType) => ({
              ...issueType,
              launch_bindings: { ...issueType.launch_bindings, nodes: [] },
            })),
          },
        } as never;
      },
    });

    const details = await screen.findByRole("region", { name: "Details" });
    await within(details).findByRole("button", { name: "Run subtree" });
    await within(details).findByRole("button", { name: "Ideas" });
    expect(within(details).queryByRole("button", { name: "Run item" })).toBeNull();
  });

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
      name: "Run subtree serially",
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
        within(details).getByRole("button", { name: "Run subtree serially" }),
      ).toBeDisabled(),
    );
    await waitFor(() =>
      expect(hasToast("error", "is no longer available")).toBe(true),
    );
    expect(
      within(details).getByRole("button", { name: "Run subtree" }),
    ).toHaveAttribute(
      "title",
      "Subtree execution is not available in this item's current state.",
    );
    expect(within(details).getByRole("button", { name: "Run item" })).toBeEnabled();
    expect(within(details).queryByRole("button", { name: "Run agent" })).toBeNull();
  });

  it("[overhaul-339] gates subtree launches on a persisted active run and restores them after completion", async () => {
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
    const open = await within(details).findByRole("button", {
      name: "Open subtree run",
    });
    expect(within(details).getByLabelText("Agent is actively working")).toBeVisible();
    expect(within(details).queryByRole("button", { name: "Run subtree" })).toBeNull();
    expect(
      within(details).queryByRole("button", { name: "Run subtree serially" }),
    ).toBeNull();
    expect(within(details).getByRole("button", { name: "Run item" })).toBeEnabled();

    fireEvent.click(open);
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(http.graphRunCount("story-1")).toBe(0);

    useClientStore.getState().selectTask("story-1");
    await within(details).findByRole("button", { name: "Open subtree run" });

    useAgentStatusStore.getState().applyState(
      "campaign-child-run",
      "exited",
      "2026-09-21T10:01:00Z",
    );
    expect(
      await within(details).findByRole("button", { name: "Run subtree" }),
    ).toBeEnabled();
    expect(
      within(details).getByRole("button", { name: "Run subtree serially" }),
    ).toBeEnabled();
    expect(
      within(details).queryByRole("button", { name: "Open subtree run" }),
    ).toBeNull();
  });

  it("[overhaul-340] refreshes a stale persisted run after refusal without retrying", async () => {
    const http = campaignFixture();
    mountStudio({
      http,
      selectedTaskId: "story-1",
      children: <NormalRunShortcutSurface />,
      graphQlExecution: true,
    });

    const details = await screen.findByRole("region", { name: "Details" });
    const runSubtree = await within(details).findByRole("button", {
      name: "Run subtree",
    });
    http.persistGraphRun("story-1", "2026-09-21T10:00:00Z");
    useAgentStatusStore.getState().upsertRun({
      agent_run_id: "already-running-child",
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
    http.failNextGraphRun(409, { detail: "A campaign is already live." });

    fireEvent.click(runSubtree);
    expect(
      await within(details).findByRole("button", { name: "Open subtree run" }),
    ).toBeVisible();
    expect(http.graphRunCount("story-1")).toBe(1);
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(http.graphRunCount("story-1")).toBe(1);
  });
});
