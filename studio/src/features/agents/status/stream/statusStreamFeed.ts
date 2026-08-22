/**
 * The Studio status consumer over the durable GraphQL subscription.
 *
 * It is the single authority for one project's status holding while it runs:
 * the legacy socket feed and this feed are never started together, so no
 * holding has two writers during development. Its responsibilities are exactly
 * the ones the socket feed had — reconnect, project isolation, snapshot
 * reconciliation, WorkItem and workflow convergence, document availability —
 * expressed against durable facts and one retained cursor per project.
 */
import type { CreateGraphQlTransportProxy } from "../../../../graphql-foundation/foundationClient";
import type {
  RunStatusEventFrame,
  RunStatusResetRequiredFrame,
} from "../generated/statusStream";
import {
  createStatusStreamClient,
  type StatusStreamClient,
} from "../statusStreamClient";
import {
  createStatusCursorStore,
  type StatusCursorStore,
} from "../statusStreamCursors";
import { useAgentStatusStore } from "../store";
import {
  createAuthoritativeReset,
  type AuthoritativeReset,
} from "./authoritativeReset";
import { refreshCanonicalHoldings } from "./canonicalRefresh";
import { refreshDocumentRegistries } from "./documentAvailability";
import {
  createDocumentInvalidator,
  type DocumentInvalidator,
} from "./documentInvalidation";
import { applyCreatedDocumentFact } from "./documentDiscovery";
import { applySnapshotFrame } from "./statusSnapshot";
import { readStatusFact } from "./statusFacts";
import { applyRunStatusFact } from "./runStatusHolding";
import { refreshTerminalHoldings } from "./terminalInvalidation";
import {
  createWorkItemInvalidator,
  type WorkItemInvalidator,
} from "./workItemInvalidation";
import { applyWorkflowStateFact } from "./workflowStateConvergence";
import {
  createWorktreeInvalidator,
  refreshWorktreeHoldings,
  type WorktreeInvalidator,
} from "./worktreeInvalidation";

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_CAP_MS = 15_000;
/** A burst of facts about runs this holding has never seen costs one resync. */
const RESYNC_DEBOUNCE_MS = 250;

export interface StatusStreamFeedOptions {
  readonly createProxy: CreateGraphQlTransportProxy;
}

/**
 * One retained cursor per project, for the lifetime of the module. A project
 * switched away from and back to resumes where it left off; a reload starts
 * from a fresh authoritative snapshot, which is equally correct.
 */
const cursors: StatusCursorStore = createStatusCursorStore();

interface ActiveFeed {
  readonly projectId: string;
  stop(): void;
}

let active: ActiveFeed | null = null;

export const statusStreamFeed = {
  start(projectId: string, options: StatusStreamFeedOptions): void {
    if (active?.projectId === projectId) return;
    active?.stop();
    useAgentStatusStore.getState().switchProject(projectId);

    let stopped = false;
    let attempt = 0;
    let generation = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let resyncTimer: ReturnType<typeof setTimeout> | null = null;
    let client: StatusStreamClient | null = null;
    // The cursor of the snapshot the current handshake published. It is the
    // authoritative Agent Run and Automation Attempt read a reset depends on,
    // so a reset without one refuses to baseline.
    let snapshotCursor: number | null = null;
    // The subscription generation that owned the reset now in flight.
    let resetGeneration = 0;
    const invalidator: WorkItemInvalidator = createWorkItemInvalidator();
    const documents: DocumentInvalidator = createDocumentInvalidator();
    const worktrees: WorktreeInvalidator = createWorktreeInvalidator();

    /** Only the currently owned subscription may write into this project. */
    const owns = (subscription: number) =>
      !stopped && subscription === generation;

    const scheduleReconnect = () => {
      if (stopped || retry) return;
      const base = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** attempt++);
      retry = setTimeout(() => {
        retry = null;
        connect();
      }, base + Math.random() * base * 0.25);
    };

    /**
     * Reopen the handshake. The server replays from the retained cursor and
     * republishes an authoritative snapshot, which is how a fact about a run
     * this holding has never seen — a launch that started after the last
     * snapshot — becomes a complete record rather than a state applied to
     * nothing.
     */
    const resync = () => {
      if (stopped || resyncTimer) return;
      resyncTimer = setTimeout(() => {
        resyncTimer = null;
        reconnectNow();
      }, RESYNC_DEBOUNCE_MS);
    };

    const applyEvent = (frame: RunStatusEventFrame): void => {
      const fact = readStatusFact(frame);
      if (!fact) return;
      const runResult = applyRunStatusFact(fact);
      if (runResult === "unknown_run") {
        resync();
        return;
      }
      if (runResult === "applied") return;
      const runs = useAgentStatusStore.getState();
      switch (fact.family) {
        case "automation_attempt":
          runs.upsertAutomationAttempt(fact.attempt);
          return;
        case "work_item":
          if (fact.removed) invalidator.recordRemoval(fact.workItemId);
          else invalidator.record(fact.workItemId, fact.membershipChanged);
          return;
        case "workflow_state":
          applyWorkflowStateFact(
            projectId,
            fact.stateId,
            fact.removed,
            fact.state,
          );
          return;
        case "document":
          applyCreatedDocumentFact(fact);
          documents.record({ scope: fact.scope, ownerId: fact.ownerId });
          return;
        case "worktree":
          // A fact the durable outbox partitioned into another project cannot
          // describe this one's holdings, however late it arrives.
          if (fact.projectId !== projectId) return;
          worktrees.record(fact.topLevelTaskId);
      }
    };

    /**
     * A refresh that could not complete must not leave a baseline behind. The
     * subscription is closed, every frame still queued from it is made unowned,
     * and the retry resumes from the cursor the server already refused — which
     * resets again, refetches again, and drains the same buffered facts.
     */
    const closeAndRetry = () => {
      if (stopped) return;
      const previous = client;
      client = null;
      generation += 1;
      void previous?.stop().catch(() => {});
      scheduleReconnect();
    };

    const reset: AuthoritativeReset = createAuthoritativeReset({
      refresh: () => refreshCanonicalHoldings({ projectId, snapshotCursor }),
      install: (cursor) => client?.acceptBaseline(cursor),
      applyEvent: (frame) => applyEvent(frame),
      owns: () => !stopped && resetGeneration === generation,
      onFailed: closeAndRetry,
    });

    const applyReset = (frame: RunStatusResetRequiredFrame): void => {
      // The retained cursor cannot be honoured, so nothing local is trusted as
      // history: work queued from it is dropped, the canonical holdings are
      // refetched, and only then is the supplied baseline installed.
      if (frame.project_id !== projectId) return;
      invalidator.cancel();
      documents.cancel();
      worktrees.cancel();
      resetGeneration = generation;
      reset.begin(frame.cursor);
    };

    const connect = () => {
      if (stopped) return;
      const subscription = ++generation;
      snapshotCursor = null;
      const next = createStatusStreamClient({
        projectId,
        subscriptionId: `run-status:${projectId}:${subscription}`,
        cursors,
        createProxy: options.createProxy,
        handlers: {
          onSnapshot(frame) {
            if (!owns(subscription)) return;
            attempt = 0;
            if (applySnapshotFrame(frame)) snapshotCursor = frame.cursor;
          },
          onEvent(frame) {
            if (!owns(subscription)) return;
            // A fact newer than an unusable baseline is buffered, not dropped.
            if (reset.capture(frame)) return;
            applyEvent(frame);
          },
          onCaughtUp() {
            if (!owns(subscription)) return;
            // Replay is complete, so this is the reconnect boundary at which
            // capabilities outside the outbox refresh authoritatively.
            invalidator.flush();
            documents.flush();
            worktrees.flush();
            refreshDocumentRegistries();
            void refreshTerminalHoldings();
            // Live Git state can have moved while the stream was gone without
            // any fact this client received saying so.
            void refreshWorktreeHoldings();
          },
          onResetRequired(frame) {
            if (!owns(subscription)) return;
            applyReset(frame);
          },
          onFailed() {
            if (!owns(subscription)) return;
            scheduleReconnect();
          },
          onComplete() {
            if (!owns(subscription)) return;
            scheduleReconnect();
          },
        },
      });
      client = next;
      void next.start().catch(() => {
        if (owns(subscription)) scheduleReconnect();
      });
    };

    const reconnectNow = () => {
      if (stopped) return;
      if (retry) {
        clearTimeout(retry);
        retry = null;
      }
      const previous = client;
      client = null;
      // Bumping the generation first makes every frame still queued from the
      // previous subscription unowned, so teardown cannot cross a boundary.
      generation += 1;
      void previous?.stop().catch(() => {});
      connect();
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      reconnectNow();
    };
    // A transport does not reliably report closure while the network is down.
    // Replacing the subscription as soon as the page is online again
    // guarantees the retained cursor is replayed promptly.
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", reconnectNow);
    connect();

    const stop = () => {
      stopped = true;
      generation += 1;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", reconnectNow);
      invalidator.cancel();
      documents.cancel();
      worktrees.cancel();
      reset.cancel();
      if (retry) clearTimeout(retry);
      if (resyncTimer) clearTimeout(resyncTimer);
      const previous = client;
      client = null;
      void previous?.stop().catch(() => {});
      if (active?.stop === stop) active = null;
    };

    active = { projectId, stop };
  },

  stop(): void {
    active?.stop();
  },

  /** Test seam: forget every retained cursor. */
  resetCursors(projectId: string): void {
    cursors.forget(projectId);
  },
};

// Vite preserves Zustand state across Fast Refresh, but module-scoped
// subscription handles are replaced. Close the old subscription so the
// replacement resumes from the retained cursor instead of silently baselining
// over cached rows.
if (import.meta.hot) {
  import.meta.hot.dispose(() => statusStreamFeed.stop());
}
