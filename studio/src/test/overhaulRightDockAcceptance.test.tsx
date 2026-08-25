import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioFooter } from "../app/shell/StudioFooter";
import { RightDockLayout } from "../app/shell/right-dock/RightDockLayout";
import {
  RIGHT_DOCK_DEFAULT_WIDTH,
  useRightDockStore,
} from "../app/shell/right-dock/rightDockStore";
import { useStudioStore } from "../features/projects/store";
import { queryClient } from "../shared/query/queryClient";
import { queryKeys } from "../shared/query/keys";
import { useClientStore } from "../state/clientStore";

vi.mock("../features/terminal-panel", () => ({
  FooterTerminalToggle: () => (
    <button type="button" data-testid="footer-terminal-toggle">
      Terminal
    </button>
  ),
}));

vi.mock("../features/agents/terminal", () => ({
  focusTerminal: () => {},
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const MODULE_ONE = "22222222-2222-4222-8222-222222222222";
const MODULE_TWO = "33333333-3333-4333-8333-333333333333";
const MODULE_THREE = "44444444-4444-4444-8444-444444444444";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("overhaul acceptance: generic right dock", () => {
  const fetchMock = vi.fn();
  let releaseModuleOne: (() => void) | null = null;
  let moduleOneWorktrees: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    queryClient.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    useStudioStore.setState({ selectedProjectId: PROJECT_ID });
    useClientStore.setState({ selectedModuleId: MODULE_ONE });
    useRightDockStore.setState({
      open: false,
      selectedViewId: null,
      width: RIGHT_DOCK_DEFAULT_WIDTH,
    });

    const moduleOneGate = new Promise<void>((resolve) => {
      releaseModuleOne = resolve;
    });
    moduleOneWorktrees = [
      {
        id: "worktree-2",
        task_id: "task-2",
        project_id: PROJECT_ID,
        module_id: MODULE_ONE,
        ticket_seq: 2,
        path: "/repo/worktrees/task-2",
        branch: "wt/CODING-2",
        base_branch: "main",
        status: "active",
        created_at: "2026-08-24T10:00:00Z",
      },
      {
        id: "worktree-1",
        task_id: "task-1",
        project_id: PROJECT_ID,
        module_id: MODULE_ONE,
        ticket_seq: 1,
        path: "/repo/worktrees/task-1",
        branch: "wt/CODING-1",
        base_branch: "main",
        status: "conflict",
        created_at: "2026-08-24T11:00:00Z",
      },
    ];

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/modules/${MODULE_ONE}/worktrees`)) {
        await moduleOneGate;
        return json(moduleOneWorktrees);
      }
      if (url.includes(`/modules/${MODULE_ONE}/ship-records`)) {
        return json([
          shipRecord({
            id: "ship-orphaned",
            taskId: "task-discarded",
            branch: "wt/orphaned",
            actionAt: "2026-08-24T12:00:00Z",
          }),
          shipRecord({
            id: "ship-task-2-partial",
            taskId: "task-2",
            branch: "wt/CODING-2-partial",
            actionAt: "2026-08-24T11:00:00Z",
            commitSha: "b".repeat(40),
            pushOutcome: {
              status: "failed",
              message: "Remote rejected the push.",
            },
          }),
          shipRecord({
            id: "ship-task-2-pr",
            taskId: "task-2",
            branch: "wt/CODING-2-shipped",
            actionAt: "2026-08-24T10:00:00Z",
            commitSha: "c".repeat(40),
            prUrl: "https://github.com/ticketry-hq/ticketry/pull/42",
            prNumber: 42,
            prState: "open",
          }),
          shipRecord({
            id: "ship-base",
            taskId: null,
            branch: "main",
            actionAt: "2026-08-24T09:00:00Z",
            commitSha: "d".repeat(40),
          }),
        ]);
      }
      if (url.includes(`/modules/${MODULE_TWO}/worktrees`)) {
        return json({ detail: "read failed" }, 503);
      }
      if (url.includes(`/modules/${MODULE_TWO}/ship-records`)) {
        return json({ detail: "history read failed" }, 503);
      }
      if (url.includes(`/modules/${MODULE_THREE}/worktrees`)) {
        return json([]);
      }
      if (url.includes(`/modules/${MODULE_THREE}/ship-records`)) {
        return json([]);
      }
      return json({ detail: `Unexpected request: ${url}` }, 500);
    });
  });

  afterEach(() => {
    releaseModuleOne?.();
    vi.unstubAllGlobals();
  });

  it("[overhaul-217] opens one module-scoped Worktrees view beside the workspace and preserves the Base row", async () => {
    render(
      <div className="flex h-[600px] flex-col">
        <div className="min-h-0 flex-1">
          <RightDockLayout>
            <main aria-label="Module workspace">
              <div data-testid="terminal-panel">Terminal shell</div>
            </main>
          </RightDockLayout>
        </div>
        <StudioFooter />
      </div>,
    );

    const terminalToggle = screen.getByTestId("footer-terminal-toggle");
    const worktreesToggle = screen.getByTestId("footer-worktrees-toggle");
    expect(terminalToggle.parentElement).toContainElement(worktreesToggle);
    expect(terminalToggle.parentElement).toContainElement(
      screen.getByRole("button", { name: "Open Settings" }),
    );

    fireEvent.click(worktreesToggle);

    expect(
      screen.getByRole("region", { name: "Worktrees dock" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("separator", { name: "Resize right dock" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("listitem", {
        name: `Base checkout for module ${MODULE_ONE}`,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Loading active task worktrees" }),
    ).toBeInTheDocument();

    const workspace = screen.getByTestId("main-workspace-column");
    const terminal = screen.getByTestId("terminal-panel");
    const dock = screen.getByTestId("right-dock");
    expect(workspace).toContainElement(terminal);
    expect(workspace).not.toContainElement(dock);
    expect(dock).not.toContainElement(terminal);

    await act(async () => {
      releaseModuleOne?.();
      await Promise.resolve();
    });
    const taskRows = await screen.findAllByRole("listitem", {
      name: /Task worktree/,
    });
    expect(taskRows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Task worktree task-2",
      "Task worktree task-1",
    ]);
    const worktreeReads = fetchMock.mock.calls.filter(([input]) =>
      String(input).endsWith(`/modules/${MODULE_ONE}/worktrees`)
    );
    expect(worktreeReads).toHaveLength(1);
    expect(String(worktreeReads[0][0])).toBe(
      `/api/work-tracker/projects/${PROJECT_ID}/modules/${MODULE_ONE}/worktrees`,
    );
    expect(
      Array.from(
        screen.getByRole("list", { name: "Module checkouts" }).children,
      ).map((row) => row.getAttribute("aria-label")),
    ).toEqual([
      `Base checkout for module ${MODULE_ONE}`,
      "Task worktree task-2",
      "Task worktree task-1",
    ]);

    const historyReads = fetchMock.mock.calls.filter(([input]) =>
      String(input).endsWith(`/modules/${MODULE_ONE}/ship-records`)
    );
    expect(historyReads).toHaveLength(1);
    expect(String(historyReads[0][0])).toBe(
      `/api/work-tracker/projects/${PROJECT_ID}/modules/${MODULE_ONE}/ship-records`,
    );

    const baseRow = screen.getByRole("listitem", {
      name: `Base checkout for module ${MODULE_ONE}`,
    });
    expect(within(baseRow).getByLabelText("Branch main")).toBeInTheDocument();
    expect(within(baseRow).getByLabelText(`Commit ${"d".repeat(40)}`))
      .toHaveTextContent("ddddddd");

    const taskTwoRow = screen.getByRole("listitem", {
      name: "Task worktree task-2",
    });
    expect(
      within(taskTwoRow)
        .getAllByRole("listitem", { name: /Ship record from/ })
        .map((record) => within(record).getByLabelText(/Branch /).textContent),
    ).toEqual(["wt/CODING-2-partial", "wt/CODING-2-shipped"]);
    expect(
      within(taskTwoRow).getByRole("listitem", {
        name: "Push outcome: Failed. Remote rejected the push.",
      }),
    ).toHaveTextContent("Push: Failed. Remote rejected the push.");
    expect(within(taskTwoRow).getByLabelText("No pull request"))
      .toBeInTheDocument();
    const prLink = within(taskTwoRow).getByRole("link", {
      name: "Open pull request #42",
    });
    expect(prLink).toHaveAttribute(
      "href",
      "https://github.com/ticketry-hq/ticketry/pull/42",
    );
    expect(prLink).toHaveAttribute("target", "_blank");
    expect(prLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(taskTwoRow).getByLabelText("Pull request state Open"))
      .toHaveTextContent("State: Open");
    expect(screen.queryByText("wt/orphaned")).not.toBeInTheDocument();

    useRightDockStore.getState().setWidth(36);
    fireEvent.click(screen.getByTestId("footer-worktrees-toggle"));
    expect(screen.queryByTestId("right-dock")).not.toBeInTheDocument();
    expect(screen.getByTestId("main-workspace-column")).toHaveAttribute(
      "data-panel-size",
      "100.0",
    );
    expect(useRightDockStore.getState().width).toBe(36);

    fireEvent.click(screen.getByTestId("footer-worktrees-toggle"));
    await screen.findByRole("listitem", { name: "Task worktree task-2" });

    moduleOneWorktrees = moduleOneWorktrees.filter(
      (worktree) => worktree.task_id !== "task-2",
    );
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.worktrees.byModule(PROJECT_ID, MODULE_ONE),
        exact: true,
      });
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("listitem", { name: "Task worktree task-2" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      queryClient
        .getQueryData<Array<{ task_id: string }>>(
          queryKeys.shipRecords.byModule(PROJECT_ID, MODULE_ONE),
        )
        ?.some((record) => record.task_id === "task-2"),
    ).toBe(true);

    act(() => useClientStore.setState({ selectedModuleId: MODULE_TWO }));

    expect(
      await screen.findByRole("listitem", {
        name: `Base checkout for module ${MODULE_TWO}`,
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("alert", {
        name: "Active task worktrees read error",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("alert", { name: "Module ship history read error" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("listitem", { name: "Task worktree task-2" }),
    ).not.toBeInTheDocument();

    act(() => useClientStore.setState({ selectedModuleId: MODULE_THREE }));
    expect(
      await screen.findByRole("listitem", {
        name: `Base checkout for module ${MODULE_THREE}`,
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("status", { name: "No active task worktrees" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "No ship history for Base checkout" }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByTestId("right-dock")).getByRole("button", {
        name: "Close Worktrees dock",
      }),
    );
    expect(screen.queryByTestId("right-dock")).not.toBeInTheDocument();

    act(() => useClientStore.setState({ selectedModuleId: null }));
    const unavailableToggle = screen.getByTestId("footer-worktrees-toggle");
    expect(unavailableToggle).toBeDisabled();
    fireEvent.click(unavailableToggle);
    await waitFor(() =>
      expect(screen.queryByTestId("right-dock")).not.toBeInTheDocument(),
    );
  });

  it("[overhaul-220] refreshes only the selected PR record and preserves failures", async () => {
    let releaseRefresh = (): void => {};
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let firstRefreshCalls = 0;
    let failedRefreshCalls = 0;
    const firstRecord = shipRecord({
      id: "ship-refresh-success",
      taskId: "task-2",
      branch: "wt/CODING-2",
      actionAt: "2026-08-24T12:00:00Z",
      prUrl: "https://github.com/ticketry-hq/ticketry/pull/42",
      prNumber: 42,
      prState: "open",
    });
    const secondRecord = shipRecord({
      id: "ship-refresh-failure",
      taskId: "task-2",
      branch: "wt/CODING-2",
      actionAt: "2026-08-24T11:00:00Z",
      prUrl: "https://github.com/ticketry-hq/ticketry/pull/43",
      prNumber: 43,
      prState: "closed",
    });

    fetchMock.mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : null;
        const url = request?.url ?? String(input);
        const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
        if (method === "GET" && url.endsWith(`/modules/${MODULE_ONE}/worktrees`)) {
          return json([moduleOneWorktrees[0]]);
        }
        if (method === "GET" && url.endsWith(`/modules/${MODULE_ONE}/ship-records`)) {
          return json([firstRecord, secondRecord]);
        }
        if (method === "POST" && url.includes("ship-refresh-success/refresh-pr-state")) {
          firstRefreshCalls += 1;
          await refreshGate;
          return json({
            ...firstRecord,
            pr_state: "merged",
            pr_refreshed_at: "2026-08-24T12:05:00Z",
          });
        }
        if (method === "POST" && url.includes("ship-refresh-failure/refresh-pr-state")) {
          failedRefreshCalls += 1;
          return json(
            {
              detail: "GitHub could not refresh this pull request state.",
              code: "provider_lookup_failed",
            },
            502,
          );
        }
        return json({ detail: `Unexpected request: ${method} ${url}` }, 500);
      },
    );

    render(
      <div className="flex h-[600px] flex-col">
        <div className="min-h-0 flex-1">
          <RightDockLayout>
            <main aria-label="Module workspace" />
          </RightDockLayout>
        </div>
        <StudioFooter />
      </div>,
    );
    fireEvent.click(screen.getByTestId("footer-worktrees-toggle"));

    const successfulControl = await screen.findByRole("button", {
      name: "Refresh pull request #42 state",
    });
    const failingControl = screen.getByRole("button", {
      name: "Refresh pull request #43 state",
    });
    const otherLink = screen.getByRole("link", {
      name: "Open pull request #43",
    });

    fireEvent.click(successfulControl);
    fireEvent.click(successfulControl);

    await waitFor(() => expect(successfulControl).toBeDisabled());
    expect(successfulControl).toHaveAttribute("aria-busy", "true");
    expect(failingControl).toBeEnabled();
    expect(otherLink).toHaveAttribute(
      "href",
      "https://github.com/ticketry-hq/ticketry/pull/43",
    );
    expect(firstRefreshCalls).toBe(1);

    await act(async () => {
      releaseRefresh();
      await refreshGate;
    });

    expect(await screen.findByLabelText("Pull request state Merged"))
      .toHaveTextContent("State: Merged");
    expect(
      queryClient
        .getQueryData<Array<{ id: string; pr_state: string }>>(
          queryKeys.shipRecords.byModule(PROJECT_ID, MODULE_ONE),
        )
        ?.find((record) => record.id === "ship-refresh-success")?.pr_state,
    ).toBe("merged");

    fireEvent.click(failingControl);

    expect(
      await screen.findByRole("alert", {
        name: "Pull request #43 refresh error",
      }),
    ).toHaveTextContent("GitHub could not refresh this pull request state.");
    expect(screen.getByLabelText("Pull request state Closed"))
      .toHaveTextContent("State: Closed");
    expect(screen.getByLabelText("Pull request state Merged"))
      .toHaveTextContent("State: Merged");
    expect(failedRefreshCalls).toBe(1);
  });

  it("[overhaul-219] ignores a late ship-history response after the module changes", async () => {
    let releaseOldHistory: ((response: Response) => void) | null = null;
    let oldHistorySignal: AbortSignal | null = null;

    fetchMock.mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes(`/modules/${MODULE_ONE}/ship-records`)) {
          oldHistorySignal = init?.signal ?? null;
          return new Promise<Response>((resolve) => {
            releaseOldHistory = resolve;
          });
        }
        if (url.includes(`/modules/${MODULE_ONE}/worktrees`)) return json([]);
        if (url.includes(`/modules/${MODULE_THREE}/worktrees`)) return json([]);
        if (url.includes(`/modules/${MODULE_THREE}/ship-records`)) return json([]);
        return json({ detail: `Unexpected request: ${url}` }, 500);
      },
    );

    render(
      <div className="flex h-[600px] flex-col">
        <div className="min-h-0 flex-1">
          <RightDockLayout>
            <main aria-label="Module workspace" />
          </RightDockLayout>
        </div>
        <StudioFooter />
      </div>,
    );
    fireEvent.click(screen.getByTestId("footer-worktrees-toggle"));

    expect(
      await screen.findByRole("listitem", {
        name: `Base checkout for module ${MODULE_ONE}`,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Loading module ship history" }),
    ).toBeInTheDocument();

    act(() => useClientStore.setState({ selectedModuleId: MODULE_THREE }));
    expect(
      await screen.findByRole("listitem", {
        name: `Base checkout for module ${MODULE_THREE}`,
      }),
    ).toBeInTheDocument();
    await waitFor(() => expect(oldHistorySignal?.aborted).toBe(true));

    await act(async () => {
      releaseOldHistory?.(
        json([
          shipRecord({
            id: "late-old-module-record",
            taskId: null,
            branch: "stale-old-module-branch",
            actionAt: "2026-08-24T12:00:00Z",
          }),
        ]),
      );
      await Promise.resolve();
    });

    expect(
      screen.getByRole("listitem", {
        name: `Base checkout for module ${MODULE_THREE}`,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("stale-old-module-branch"))
      .not.toBeInTheDocument();
  });
});

function shipRecord({
  id,
  taskId,
  branch,
  actionAt,
  commitSha = "a".repeat(40),
  pushOutcome = { status: "done" },
  prUrl = null,
  prNumber = null,
  prState = null,
}: {
  id: string;
  taskId: string | null;
  branch: string;
  actionAt: string;
  commitSha?: string;
  pushOutcome?: { status: string; message?: string };
  prUrl?: string | null;
  prNumber?: number | null;
  prState?: string | null;
}) {
  return {
    id,
    action_id: `${id}-action`,
    module_id: MODULE_ONE,
    task_id: taskId,
    checkout_kind: taskId ? "worktree" : "base",
    checkout_name: taskId ? `Checkout ${taskId}` : "Base checkout",
    branch,
    commit_shas: [commitSha],
    commit_outcome: { status: "done" },
    push_outcome: pushOutcome,
    create_pr_outcome: { status: prUrl ? "done" : "skipped" },
    pr_url: prUrl,
    pr_number: prNumber,
    pr_state: prState,
    action_at: actionAt,
    pr_refreshed_at: null,
  };
}
