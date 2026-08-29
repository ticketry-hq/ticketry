import { useCallback, useMemo } from "react";
import type {
  DesignDoc,
  ResumableTerminalSession,
} from "../agents/types";
import type { SessionTab } from "../agents/terminal";
import { useWorkspaceTabReorderDrag } from "./internal/useWorkspaceTabReorderDrag";
import { workspaceTabIdentityKey } from "./ordering";
import type { WorkspaceTabOrderQuery } from "./queries";
import type { WorkspaceTabIdentity } from "./types";
import { useWorkspaceTabLifecycleOrder } from "./useWorkspaceTabLifecycleOrder";

export function useWorkspaceTabOrdering({
  workItemId,
  savedOrder,
  documents,
  openDocuments,
  terminalTabs,
  resumableSessions,
  visibleOrder,
}: {
  workItemId: string | null;
  savedOrder: WorkspaceTabOrderQuery;
  documents: readonly DesignDoc[];
  openDocuments: readonly DesignDoc[];
  terminalTabs: readonly SessionTab[];
  resumableSessions: readonly ResumableTerminalSession[];
  visibleOrder: readonly WorkspaceTabIdentity[];
}) {
  const toPersistentIdentity = useCallback(
    (identity: WorkspaceTabIdentity): WorkspaceTabIdentity => {
      if (identity.kind !== "terminal") return identity;
      const terminal = terminalTabs.find((tab) => tab.id === identity.id);
      return {
        kind: "terminal",
        id: terminal?.meta.agentRunId ?? identity.id,
      };
    },
    [terminalTabs],
  );
  const knownIdentities = useMemo(() => {
    const identities: WorkspaceTabIdentity[] = [
      { kind: "details" },
      ...savedOrder.order,
      ...documents.map((document) => ({
        kind: "doc" as const,
        id: document.id,
      })),
      ...resumableSessions.map((session) => ({
        kind: "terminal" as const,
        id: session.agent_run_id,
      })),
      ...terminalTabs.map((tab) => ({
        kind: "terminal" as const,
        id: tab.meta.agentRunId ?? tab.id,
      })),
    ];
    return [...new Map(
      identities.map((identity) => [workspaceTabIdentityKey(identity), identity]),
    ).values()];
  }, [documents, resumableSessions, savedOrder.order, terminalTabs]);

  const reorderDrag = useWorkspaceTabReorderDrag({
    workItemId,
    visibleOrder,
    savedOrder,
    knownIdentities,
    toPersistentIdentity,
  });
  useWorkspaceTabLifecycleOrder({
    workItemId,
    savedOrder: savedOrder.order,
    orderReady: savedOrder.isReady,
    visibleIdentities: [
      { kind: "details" },
      ...openDocuments.map((document) => ({
        kind: "doc" as const,
        id: document.id,
      })),
      ...terminalTabs.flatMap((tab) =>
        tab.meta.agentRunId
          ? [{ kind: "terminal" as const, id: tab.meta.agentRunId }]
          : [],
      ),
    ],
  });

  return reorderDrag;
}
