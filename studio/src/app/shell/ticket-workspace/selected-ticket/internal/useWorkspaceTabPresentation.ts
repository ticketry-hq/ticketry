import type {
  DesignDoc,
  ResumableTerminalSession,
} from "../../../../../features/agents/types";
import type { SessionTab } from "../../../../../features/agents/terminal";
import {
  DEFAULT_WORKSPACE,
  useClientStore as useTicketWorkspaceStore,
} from "../../../../../state/clientStore";
import { useVisibleTerminalHistory } from "../terminals/useWorkspaceTerminalSessions";
import type { TaskWorkspaceTabIdentity } from "./useTaskWorkspaceTabNavigation";

export function useWorkspaceTabPresentation({
  bucket,
  projectId,
  moduleId,
  documents,
  terminalTabs,
  activeTerminalId,
  resumableSessions,
}: {
  bucket: string | null;
  projectId: string | null;
  moduleId: string | null;
  documents: readonly DesignDoc[];
  terminalTabs: readonly SessionTab[];
  activeTerminalId: string | null;
  resumableSessions: readonly ResumableTerminalSession[];
}) {
  const workspaces = useTicketWorkspaceStore((state) => state.workspaces);
  const workspace = bucket
    ? workspaces[bucket] ?? DEFAULT_WORKSPACE
    : DEFAULT_WORKSPACE;
  const terminalIds = terminalTabs.map((tab) => tab.id);
  const closedDocumentIds = new Set(workspace.closedDocIds);
  const openDocuments = documents.filter(
    (document) => !closedDocumentIds.has(document.id),
  );
  const closedDocuments = documents.filter((document) =>
    closedDocumentIds.has(document.id),
  );
  // The API already caps this history, but retain the presentation bound at
  // the UI seam so a malformed response cannot grow the dormant chip row.
  const resumable = resumableSessions.slice(0, 10);
  const resumableRunIds = new Set(
    resumable.map((session) => session.agent_run_id),
  );
  const visibleHistory = useVisibleTerminalHistory({
    bucket,
    projectId,
    moduleId,
    excludedRunIds: resumableRunIds,
  });
  const activeDocument =
    openDocuments.find((document) => document.id === workspace.activeDocId) ??
    openDocuments[0] ??
    null;

  let activeKind = workspace.active;
  if (
    activeKind === "terminal" &&
    (terminalIds.length === 0 || !activeTerminalId)
  ) {
    activeKind = "details";
  }
  if (activeKind === "doc" && !activeDocument) activeKind = "details";

  const navigableTabs: TaskWorkspaceTabIdentity[] = [
    { kind: "details" },
    ...openDocuments.map((document) => ({
      kind: "doc" as const,
      id: document.id,
    })),
    ...terminalIds.map((id) => ({ kind: "terminal" as const, id })),
  ];
  const activeTab: TaskWorkspaceTabIdentity =
    activeKind === "doc" && activeDocument
      ? { kind: "doc", id: activeDocument.id }
      : activeKind === "terminal" && activeTerminalId
        ? { kind: "terminal", id: activeTerminalId }
        : { kind: "details" };

  return {
    terminalIds,
    openDocuments,
    closedDocuments,
    resumable,
    visibleHistory,
    activeDocument,
    activeKind,
    navigableTabs,
    activeTab,
  };
}
