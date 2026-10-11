/**
 * CODING-2760 — a WorkItem renamed elsewhere while this browser is offline.
 *
 * The status stream can still deliver the rename's fact during the gap, but
 * every canonical read it triggers fails. Once the page is online again the
 * replacement subscription replays nothing new for that item, so the visible
 * row must converge from the canonical read the gap still owes — without a
 * reload.
 */
import { configure, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { documentOperationName } from "../graphql-foundation/typedDocument";
import { statusStreamFeed } from "../features/agents/status/stream/statusStreamFeed";
import { fixture, mountStudio, workItem } from "./seam";
import {
  resetFactCursor,
  statusFeedTransport,
  workItemChangedFact,
} from "./statusStreamFeedFixture";

configure({ asyncUtilTimeout: 5000 });

const PROJECT = "project-1";

const UNMODELED_CAUGHT_UP_READS: Record<string, (variables: Record<string, unknown>) => unknown> = {
  WorktreeStatus: ({ taskId }) => ({
    worktree_status: {
      __typename: "WorktreeStatusView",
      kind: "none",
      task_id: taskId,
      top_level_task_id: taskId,
      is_shared: false,
      branch: null,
      base_branch: null,
      path: null,
      state: null,
      clean: null,
      dirty: null,
      ahead: null,
      behind: null,
      conflict: null,
      checkout_present: null,
      ephemeral: false,
      reason: null,
    },
  }),
  TaskResumableTerminalSessions: () => ({ resumable_sessions: [] }),
  ScratchResumableTerminalSessions: () => ({ resumable_sessions: [] }),
  InstantRunTickets: () => ({ tickets: [] }),
  WorkItemEndedRuns: ({ issueId }) => ({
    work_item: {
      __typename: "WorktrackerIssueConnection",
      nodes: [{
        __typename: "WorktrackerIssue",
        id: issueId,
        project_id: PROJECT,
        module_id: null,
        ended_runs: { __typename: "AgentRunsConnection", nodes: [] },
      }],
    },
  }),
};

beforeEach(() => {
  resetFactCursor();
});

afterEach(() => {
  statusStreamFeed.stop();
  statusStreamFeed.resetCursors(PROJECT);
  vi.restoreAllMocks();
});

describe("overhaul acceptance — reconnect closes an offline edit gap", () => {
  it("[CODING-2760] shows the renamed row after reconnecting, without a reload", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: ["story-a"], children: { "story-a": [] }, order: ["story-a"] });
    http.workItems([workItem({ id: "story-a", key: "MEML-1", name: "E2E second" })]);
    let offline = false;
    const execute: typeof http.executeGraphQl = async (document, variables) => {
      if (offline) throw new TypeError("Failed to fetch");
      // The caught-up boundary also re-reads terminal and live Git holdings,
      // which the WorkItem fixture does not model; this Story has neither.
      const unmodeled = UNMODELED_CAUGHT_UP_READS[documentOperationName(document)];
      if (unmodeled) return unmodeled(variables as Record<string, unknown>) as never;
      return http.executeGraphQl(document, variables);
    };
    const feed = statusFeedTransport();
    mountStudio({ http, selectedTaskId: "story-a", graphQlExecute: execute });
    statusStreamFeed.start(PROJECT, { createProxy: feed.createProxy });
    await waitFor(() => expect(feed.ready()).toBe(true));
    feed.send({ __typename: "RunStatusCaughtUp", project_id: PROJECT, cursor: 100 });
    expect(await screen.findByRole("treeitem", { name: /E2E second/ })).toBeVisible();

    offline = true;
    // A fact already in flight for the item lands first; its read fails.
    feed.send(workItemChangedFact(PROJECT, "story-a", { occurredAt: "2026-09-05T10:00:01+00:00" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The rename is committed elsewhere and its fact arrives while offline.
    http.revise("story-a", { name: "E2E replayed" });
    feed.send(workItemChangedFact(PROJECT, "story-a", { occurredAt: "2026-09-05T10:00:02+00:00" }));
    await new Promise((resolve) => setTimeout(resolve, 100));

    offline = false;
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(feed.ready()).toBe(true));
    feed.send({ __typename: "RunStatusCaughtUp", project_id: PROJECT, cursor: 102 });

    expect(await screen.findByRole("treeitem", { name: /E2E replayed/ })).toBeVisible();
    expect(screen.queryByRole("treeitem", { name: /E2E second/ })).toBeNull();
  });
});
