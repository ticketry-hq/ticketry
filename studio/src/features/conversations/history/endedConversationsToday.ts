// The module's conversations that ended in the last day, for the Conversations
// heading's "N ended today" action.
//
// A completed conversation's process exits and its terminal session is
// terminated, so the module WorkItem restoration read — which keeps only runs
// with a live tmux session to reattach — drops it. It stays resumable through
// the provider, and the public resumable-session read is the authority for
// that. Both reads are Apollo holdings; this only counts their union by run id.
import { useMemo } from "react";

import {
  useModuleScratchEndedRuns,
  useResumableTerminalSessions,
} from "../../agents/terminal";

const ENDED_CONVERSATION_WINDOW_MS = 24 * 60 * 60 * 1000;

interface EndedConversation {
  readonly agent_run_id: string;
  readonly scope?: string | null;
  readonly endedAt: string | null | undefined;
}

/** Distinct instant runs that ended at or after `since`. */
function countEndedConversationsSince(
  conversations: readonly EndedConversation[],
  since: number,
): number {
  const ended = new Set<string>();
  for (const conversation of conversations) {
    if (conversation.scope !== "instant" || !conversation.endedAt) continue;
    if (Date.parse(conversation.endedAt) >= since) ended.add(conversation.agent_run_id);
  }
  return ended.size;
}

/** How many of the module's conversations ended within the last day. */
export function useEndedConversationsToday(
  projectId: string | null,
  moduleId: string | null,
): number {
  const reattachable = useModuleScratchEndedRuns(moduleId);
  const resumable = useResumableTerminalSessions(null, projectId, moduleId);
  return useMemo(() => countEndedConversationsSince(
    [
      ...reattachable.map((run) => ({ ...run, endedAt: run.updated_at })),
      ...resumable.map((session) => ({ ...session, endedAt: session.ended_at })),
    ],
    Date.now() - ENDED_CONVERSATION_WINDOW_MS,
  ), [reattachable, resumable]);
}
