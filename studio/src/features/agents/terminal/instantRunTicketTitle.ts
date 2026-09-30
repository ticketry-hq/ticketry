import { gql } from "@apollo/client";
import { useCallback, useEffect, useRef } from "react";
import {
  documentOperationName,
  documentSource,
} from "../../../graphql-foundation/typedDocument";
import { studioRuntime } from "../../../runtime";
import { studioApolloClient } from "../../../shared/apollo/client";
import { useAgentStatusSelection } from "../status";
import { InstantRunTicketTitleDocument } from "./generated/instantRunTicketTitle.documents";
import { InstantRunTicketTitleRestartedDocument } from "./generated/instantRunTicketTitleRestarted.documents";
import { useInstantRunTickets } from "./instantRunTickets";
import { useModuleScratchEndedRuns } from "./workItemRunRestoration";

const TITLE_READ_DEBOUNCE_MS = 100;
const pendingTitleReads = new Map<string, Promise<string | null | undefined>>();
const AcceptedTitleFragment = gql`
  fragment AcceptedInstantRunTicketTitle on InstantRunTicket {
    acceptedTitle @client
  }
`;

function readTitle(agentRunId: string) {
  let request = pendingTitleReads.get(agentRunId);
  if (!request) {
    request = studioApolloClient().query({
      query: InstantRunTicketTitleDocument,
      variables: { agentRunId },
      fetchPolicy: "no-cache",
    }).then(({ data }) => data?.title).finally(() => {
      pendingTitleReads.delete(agentRunId);
    });
    pendingTitleReads.set(agentRunId, request);
  }
  return request;
}

function acceptTitle(agentRunId: string, title: string | null | undefined) {
  if (!title?.trim()) return;
  const client = studioApolloClient();
  const id = client.cache.identify({
    __typename: "InstantRunTicket",
    agent_run_id: agentRunId,
  });
  if (!id) return;
  client.cache.writeFragment({
    id,
    fragment: AcceptedTitleFragment,
    data: { acceptedTitle: title },
  });
}

function isRestartEvent(encoded: string): boolean {
  try {
    const envelope = JSON.parse(encoded) as {
      type?: unknown;
      payload?: { data?: { instant_run_ticket_title_restarted?: unknown } };
    };
    return envelope.type === "next" &&
      envelope.payload?.data?.instant_run_ticket_title_restarted === true;
  } catch {
    return false;
  }
}

/** Reads and caches the selected Codex Instant conversation's display title. */
export function useInstantRunTicketTitle(
  projectId: string | null,
  moduleId: string | null,
  agentRunId: string | null,
): string | null {
  const tickets = useInstantRunTickets(projectId, moduleId);
  const cachedTitle = tickets.find(
    (ticket) => ticket.agentRunId === agentRunId,
  )?.title ?? null;
  const hasCachedTicket = tickets.some(
    (ticket) => ticket.agentRunId === agentRunId,
  );
  // The status stream holds live runs only (overhaul-278), so a conversation
  // that has already ended is only known through the module WorkItem read.
  const endedRuns = useModuleScratchEndedRuns(moduleId);
  const heldRun = useAgentStatusSelection(
    (holding) => (agentRunId ? holding.runs[agentRunId] ?? null : null),
  );
  const run = agentRunId
    ? heldRun ?? endedRuns.find((ended) => ended.agent_run_id === agentRunId) ?? null
    : null;
  const eligibleRunId = (
    run?.scope !== "instant" ||
    run.agent !== "codex" ||
    !run.provider_session_id?.trim()
  ) ? null : agentRunId;
  const selection = useRef({
    runId: agentRunId,
    requested: false,
    eligible: false,
  });
  const queuedRead = useRef<{
    runId: string;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const mounted = useRef(true);
  if (selection.current.runId !== agentRunId) {
    selection.current = { runId: agentRunId, requested: false, eligible: false };
  }
  selection.current.eligible = eligibleRunId === agentRunId && hasCachedTicket;

  const queueTitleRead = useCallback((runId: string, afterPending = false) => {
    if (queuedRead.current) clearTimeout(queuedRead.current.timer);
    const timer = setTimeout(() => {
      if (queuedRead.current?.timer !== timer) return;
      queuedRead.current = null;
      if (
        !mounted.current ||
        selection.current.runId !== runId ||
        !selection.current.eligible
      ) return;
      selection.current.requested = true;
      const pending = afterPending ? pendingTitleReads.get(runId) : undefined;
      void (async () => {
        await pending?.catch(() => undefined);
        if (
          !mounted.current ||
          selection.current.runId !== runId ||
          !selection.current.eligible
        ) return;
        const title = await readTitle(runId).catch(() => null);
        if (
          mounted.current &&
          selection.current.runId === runId &&
          selection.current.eligible
        ) acceptTitle(runId, title);
      })();
    }, TITLE_READ_DEBOUNCE_MS);
    queuedRead.current = { runId, timer };
  }, []);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const proxy = studioRuntime().graphQlTransport();
    const subscriptionId = `instant-title-restarts_${crypto.randomUUID()}`;
    void proxy.graphql_subscribe(
      subscriptionId,
      JSON.stringify({
        query: documentSource(InstantRunTicketTitleRestartedDocument),
        operationName: documentOperationName(InstantRunTicketTitleRestartedDocument),
        variables: {},
      }),
      (encoded) => {
        if (!active || !isRestartEvent(encoded)) return;
        const { runId, eligible } = selection.current;
        if (!runId || !eligible) return;
        queueTitleRead(runId, true);
      },
    ).catch(() => {});

    return () => {
      active = false;
      mounted.current = false;
      if (queuedRead.current) clearTimeout(queuedRead.current.timer);
      queuedRead.current = null;
      void proxy.graphql_unsubscribe(subscriptionId).catch(() => {});
    };
  }, [queueTitleRead]);

  // Codex names a thread during its first turn and may rename it on later
  // ones, so every lifecycle transition of the selected run rereads the title.
  const runState = run?.state ?? null;
  const lastRunState = useRef(runState);
  if (lastRunState.current !== runState) {
    lastRunState.current = runState;
    selection.current.requested = false;
  }

  useEffect(() => {
    if (
      !agentRunId ||
      eligibleRunId !== agentRunId ||
      !hasCachedTicket ||
      selection.current.requested
    ) {
      return;
    }
    queueTitleRead(agentRunId);

    return () => {
      if (queuedRead.current?.runId !== agentRunId) return;
      clearTimeout(queuedRead.current.timer);
      queuedRead.current = null;
    };
  }, [agentRunId, eligibleRunId, hasCachedTicket, runState, queueTitleRead]);

  return cachedTitle;
}
