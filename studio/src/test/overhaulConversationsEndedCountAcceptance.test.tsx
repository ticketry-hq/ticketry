import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { TasksPane } from "../app/shell/ticket-workspace/tasks/TasksPane";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { scratchBucketId } from "../features/agents/terminal";
import type { ResumableTerminalSession } from "../features/agents/types";
import { TEMP_TASK_ID } from "../features/agents/types";
import { useStudioStore } from "../features/projects/store";
import { StudioApolloProvider } from "../shared/apollo/StudioApolloProvider";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { useClientStore } from "../state/clientStore";
import {
  installDesktopGraphQlRuntime,
  terminalSessionReadExecutor,
  type TerminalSessionReadFixture,
  type WorkItemEndedRunFixture,
} from "./desktopGraphQlRuntime";
import { seedModuleOpenFixture } from "./projectOpenFixture";

const HOUR_MS = 60 * 60 * 1000;

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR_MS).toISOString();
}

/** An instant conversation whose provider finished and whose process exited. */
function completedConversation(
  runId: string,
  endedAt: string,
): { ended: WorkItemEndedRunFixture; resumable: ResumableTerminalSession } {
  return {
    // The module WorkItem still knows the ended run, but its terminal session
    // was terminated when the process exited, so it has no tmux to reattach.
    ended: {
      agent_run_id: runId,
      agent: "claude",
      scope: "instant",
      provider_session_id: `${runId}-provider`,
      started_at: hoursAgo(30),
      ended_at: endedAt,
      terminated_at: endedAt,
    },
    // The public resumable read still offers it for a provider resume.
    resumable: {
      agent_run_id: runId,
      agent: "claude",
      status: "exited",
      started_at: hoursAgo(30),
      ended_at: endedAt,
      provider_session_id: `${runId}-provider`,
      resumed_from: null,
      scope: "instant",
    },
  };
}

function installReads(reads: Partial<TerminalSessionReadFixture>) {
  const terminalExecutor = terminalSessionReadExecutor({
    readTaskTerminalSessions: async () => [],
    readScratchTerminalSessions: async () => [],
    readTaskResumableTerminalSessions: async () => [],
    readScratchResumableTerminalSessions: async () => [],
    ...reads,
  });
  installDesktopGraphQlRuntime(async (document, variables) => {
    const operation = documentOperationName(document);
    if (operation === "InstantRunTickets") return { tickets: [] } as never;
    if (operation === "WorkTrackerModuleOpen") {
      return {
        module: { __typename: "WorktrackerIssueConnection", nodes: [] },
        work_items: { __typename: "WorktrackerIssueConnection", nodes: [] },
      } as never;
    }
    return terminalExecutor(document, variables);
  });
}

function renderConversations() {
  render(
    <StudioApolloProvider>
      <TasksPane />
    </StudioApolloProvider>,
  );
}

describe("overhaul acceptance — Conversations ended-today count", () => {
  beforeEach(() => {
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useClientStore.setState({
      selectedModuleId: "module-1",
      selectedTaskId: TEMP_TASK_ID,
      workspaceSelection: { kind: "task" },
      storySearchQuery: "",
      focusedPane: "tasks",
      sidebarVisible: true,
      workspaces: {
        [scratchBucketId("module-1")]: {
          active: "details",
          activeDocId: null,
          closedDocIds: [],
        },
      },
      activeByTask: {},
    });
    // After a reload the live-only status stream holds no ended run.
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: {},
      automationAttempts: {},
      automationByTask: {},
    });
    seedModuleOpenFixture("module-1", []);
  });

  it("[overhaul-823] counts a completed conversation that is resumable after reload", async () => {
    const done = completedConversation("instant-run-1", hoursAgo(1));
    installReads({
      readModuleScratchEndedRuns: async () => [done.ended],
      readScratchResumableTerminalSessions: async () => [done.resumable],
    });

    renderConversations();

    expect(
      await screen.findByRole("button", { name: "1 ended today" }),
    ).toBeInTheDocument();
  });

  it("[overhaul-823] counts one conversation once when both reads report it", async () => {
    const reattachable: WorkItemEndedRunFixture = {
      agent_run_id: "instant-run-1",
      agent: "claude",
      scope: "instant",
      provider_session_id: "instant-run-1-provider",
      ended_at: hoursAgo(2),
      terminated_at: null,
    };
    const resumable = completedConversation("instant-run-1", hoursAgo(2)).resumable;
    const other = completedConversation("instant-run-2", hoursAgo(3));
    installReads({
      readModuleScratchEndedRuns: async () => [reattachable, other.ended],
      readScratchResumableTerminalSessions: async () => [resumable, other.resumable],
    });

    renderConversations();

    expect(
      await screen.findByRole("button", { name: "2 ended today" }),
    ).toBeInTheDocument();
  });

  it("[overhaul-823] leaves out conversations that ended before today's window", async () => {
    const old = completedConversation("instant-run-1", hoursAgo(25));
    let resumableRead = false;
    installReads({
      readModuleScratchEndedRuns: async () => [old.ended],
      readScratchResumableTerminalSessions: async () => {
        resumableRead = true;
        return [old.resumable];
      },
    });

    renderConversations();

    await waitFor(() => expect(resumableRead).toBe(true));
    await screen.findByRole("button", { name: "Configure Conversations" });
    expect(screen.queryByRole("button", { name: /ended today/ })).toBeNull();
  });
});
