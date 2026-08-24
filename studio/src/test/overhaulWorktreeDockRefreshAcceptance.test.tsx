import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioFooter } from "../app/shell/StudioFooter";
import { RightDockLayout } from "../app/shell/right-dock/RightDockLayout";
import {
  RIGHT_DOCK_DEFAULT_WIDTH,
  useRightDockStore,
} from "../app/shell/right-dock/rightDockStore";
import { WorktreeBlock } from "../features/agents/worktrees";
import { useStudioStore } from "../features/projects/store";
import { queryClient } from "../shared/query/queryClient";
import { useClientStore } from "../state/clientStore";

vi.mock("../features/terminal-panel", () => ({
  FooterTerminalToggle: () => <button type="button">Terminal</button>,
}));

vi.mock("../features/agents/terminal", () => ({
  focusTerminal: () => {},
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const MODULE_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "33333333-3333-4333-8333-333333333333";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const noneStatus = {
  task_id: TASK_ID,
  top_level_task_id: TASK_ID,
  is_shared: false,
  kind: "none",
};

const activeStatus = {
  ...noneStatus,
  kind: "worktree",
  branch: "wt/CODING-1071-refresh-dock",
  base_branch: "main",
  path: "/repo/worktrees/CODING-1071",
  state: "active",
  clean: true,
  dirty: false,
  ahead: 0,
  behind: 0,
  conflict: false,
};

const activeWorktree = {
  id: "worktree-created",
  task_id: TASK_ID,
  project_id: PROJECT_ID,
  module_id: MODULE_ID,
  ticket_seq: 1071,
  path: "/repo/worktrees/CODING-1071",
  branch: "wt/CODING-1071-refresh-dock",
  base_branch: "main",
  status: "active",
  created_at: "2026-08-24T12:00:00Z",
};

describe("overhaul acceptance: worktree dock refresh", () => {
  const fetchMock = vi.fn();
  let moduleWorktrees: Array<typeof activeWorktree>;

  beforeEach(() => {
    queryClient.clear();
    moduleWorktrees = [];
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    useStudioStore.setState({ selectedProjectId: PROJECT_ID });
    useClientStore.setState({ selectedModuleId: MODULE_ID });
    useRightDockStore.setState({
      open: false,
      selectedViewId: null,
      width: RIGHT_DOCK_DEFAULT_WIDTH,
    });

    fetchMock.mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : null;
        const url = request?.url ?? String(input);
        const method = (init?.method ?? request?.method ?? "GET").toUpperCase();

        if (
          method === "GET" &&
          url.endsWith(`/modules/${MODULE_ID}/worktrees`)
        ) {
          return json(moduleWorktrees);
        }
        if (
          method === "GET" &&
          url.endsWith(`/modules/${MODULE_ID}/ship-records`)
        ) {
          return json([]);
        }
        if (method === "GET" && url.includes("/worktrees?")) {
          return json(noneStatus);
        }
        if (method === "POST" && url.endsWith(`/worktrees/${TASK_ID}/create`)) {
          moduleWorktrees = [activeWorktree];
          return json(activeStatus);
        }
        return new Response(
          JSON.stringify({ detail: `Unexpected request: ${method} ${url}` }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("[overhaul-184] adds a newly created worktree to an already-open dock", async () => {
    render(
      <div className="flex h-[600px] flex-col">
        <div className="min-h-0 flex-1">
          <RightDockLayout>
            <main aria-label="Module workspace">
              <WorktreeBlock
                taskId={TASK_ID}
                moduleId={MODULE_ID}
                projectId={PROJECT_ID}
                ticketSeq={1071}
                taskName="Refresh the worktree dock"
              />
            </main>
          </RightDockLayout>
        </div>
        <StudioFooter />
      </div>,
    );

    fireEvent.click(screen.getByTestId("footer-worktrees-toggle"));
    expect(
      await screen.findByRole("status", {
        name: "No active task worktrees",
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      await screen.findByRole("button", { name: "+ Create worktree" }),
    );

    expect(
      await screen.findByRole("listitem", {
        name: `Task worktree ${TASK_ID}`,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Worktrees dock" }))
      .toBeInTheDocument();
    await waitFor(() => {
      const moduleReads = fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith(`/modules/${MODULE_ID}/worktrees`),
      );
      expect(moduleReads).toHaveLength(2);
    });
  });
});
