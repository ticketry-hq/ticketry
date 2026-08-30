import type {
  DesignDoc,
  ResumableTerminalSession,
} from "../../../../../features/agents/types";
import {
  presentDormantTerminalChips,
  type SessionTab,
} from "../../../../../features/agents/terminal";
import { useAgentStatusRuns } from "../../../../../features/agents/status";
import {
  DEFAULT_WORKSPACE,
  useClientStore as useTicketWorkspaceStore,
} from "../../../../../state/clientStore";
import { useVisibleTerminalHistory } from "../terminals/useWorkspaceTerminalSessions";
import type { TaskWorkspaceTabIdentity } from "./useTaskWorkspaceTabNavigation";
import { orderVisibleWorkspaceTabs } from "../../../../../features/workspace-tabs/ordering";

export function useWorkspaceTabPresentation({
  bucket,
  projectId,
  moduleId,
  documents,
  terminalTabs,
  activeTerminalId,
  resumableSessions,
  savedTabOrder,
  hasChangesTab,
  terminalOnly = false,
}: {
  bucket: string | null;
  projectId: string | null;
  moduleId: string | null;
  documents: readonly DesignDoc[];
  terminalTabs: readonly SessionTab[];
  activeTerminalId: string | null;
  resumableSessions: readonly ResumableTerminalSession[];
  savedTabOrder: readonly TaskWorkspaceTabIdentity[];
  hasChangesTab: boolean;
  terminalOnly?: boolean;
}) {
  const workspaces = useTicketWorkspaceStore((state) => state.workspaces);
  const workspace = bucket
    ? workspaces[bucket] ?? DEFAULT_WORKSPACE
    : DEFAULT_WORKSPACE;
  const terminalIds = terminalTabs.map((tab) => tab.id);
  const closedDocumentIds = new Set(workspace.closedDocIds);
  const openDocuments = terminalOnly ? [] : documents.filter(
    (document) => !closedDocumentIds.has(document.id),
  );
  const closedDocuments = terminalOnly
    ? []
    : documents.filter((document) => closedDocumentIds.has(document.id));
  // The API already caps this history, but retain the presentation bound at
  // the UI seam so a malformed response cannot grow the dormant chip row.
  const resumable = terminalOnly ? [] : resumableSessions.slice(0, 10);
  const resumableRunIds = new Set(
    resumable.map((session) => session.agent_run_id),
  );
  const visibleHistory = useVisibleTerminalHistory({
    bucket,
    projectId,
    moduleId,
    excludedRunIds: resumableRunIds,
  });
  // Dormant chips are the same runs the strip labels, so they are presented by
  // the same rule from the same durable records (#695). The run store supplies
  // liveness and, for a run still inside the status window, a second copy of
  // the launch snapshot the listing already carries.
  const runs = useAgentStatusRuns();
  const dormantChips = presentDormantTerminalChips({
    resumableSessions: resumable,
    history: terminalOnly ? [] : visibleHistory,
    runs,
  });
  const activeDocument =
    openDocuments.find((document) => document.id === workspace.activeDocId) ??
    openDocuments[0] ??
    null;

  let activeKind = terminalOnly && activeTerminalId
    ? "terminal" as const
    : workspace.active;
  if (
    activeKind === "terminal" &&
    (terminalIds.length === 0 || !activeTerminalId)
  ) {
    activeKind = "details";
  }
  if (activeKind === "doc" && !activeDocument) activeKind = "details";
  if (activeKind === "changes" && (!hasChangesTab || terminalOnly)) {
    activeKind = "details";
  }

  const persistentDefaultTabs: TaskWorkspaceTabIdentity[] = [
    ...(terminalOnly
      ? []
      : [
          { kind: "details" as const },
          ...(hasChangesTab ? [{ kind: "changes" as const }] : []),
        ]),
    ...openDocuments.map((document) => ({ kind: "doc" as const, id: document.id })),
    ...terminalTabs.map((tab) => ({
      kind: "terminal" as const,
      id: tab.meta.agentRunId ?? tab.id,
    })),
  ];
  const orderedPersistentTabs = orderVisibleWorkspaceTabs(
    persistentDefaultTabs,
    savedTabOrder,
  );
  const navigableTabs: TaskWorkspaceTabIdentity[] = [];
  for (const identity of orderedPersistentTabs) {
    if (identity.kind !== "terminal") {
      navigableTabs.push(identity);
      continue;
    }
    const tab = terminalTabs.find(
      (candidate) =>
        (candidate.meta.agentRunId ?? candidate.id) === identity.id,
    );
    if (tab) navigableTabs.push({ kind: "terminal", id: tab.id });
  }
  const activeTab: TaskWorkspaceTabIdentity =
    activeKind === "changes"
      ? { kind: "changes" }
      : activeKind === "doc" && activeDocument
      ? { kind: "doc", id: activeDocument.id }
      : activeKind === "terminal" && activeTerminalId
        ? { kind: "terminal", id: activeTerminalId }
        : { kind: "details" };

  return {
    terminalIds,
    openDocuments,
    closedDocuments,
    resumable,
    dormantChips,
    activeDocument,
    activeKind,
    navigableTabs,
    activeTab,
  };
}
