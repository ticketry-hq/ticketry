import { useState, type MutableRefObject } from "react";
import type {
  DesignDoc,
  ResumableTerminalSession,
  TabKind,
} from "../../../../../features/agents/types";
import {
  useTerminalStore,
  type ForegroundOwner,
  type SessionMeta,
} from "../../../../../features/agents/terminal";
import { resumeTerminal } from "../../../../../features/agents/api/agentApi";
import { FoundationGraphQlError } from "../../../../../shared/apollo/errorLink";
import {
  toast,
  useClientStore,
  useClientStore as useTicketWorkspaceStore,
} from "../../../../../state/clientStore";
import { closeTerminalTab } from "./closeTerminalTab";
import { rememberStudioWorkspaceTarget } from "./studioWorkspaceTarget";
import type { TaskWorkspaceTabIdentity } from "./useTaskWorkspaceTabNavigation";
import type {
  TicketLaunchContext,
  WorkspaceLauncherContext,
} from "./WorkspaceLauncher";

function resumeErrorMessage(error: unknown): string {
  const body = error instanceof FoundationGraphQlError ? error.extensions : null;
  const detail =
    body && typeof body === "object"
      ? (body as { detail?: unknown }).detail
      : null;
  const code =
    detail && typeof detail === "object" && "error" in detail
      ? String((detail as { error?: unknown }).error)
      : body && typeof body === "object" && "error" in body
        ? String((body as { error?: unknown }).error)
        : "";
  if (code === "cwd_missing") return "Working directory no longer exists";
  if (code === "run_still_active") {
    return "Session is still running - attach instead";
  }
  if (code === "resume_unsupported") return "This agent cannot resume sessions";
  return "Could not resume session";
}

export function useWorkspaceTabActions({
  bucket,
  projectId,
  moduleId,
  owner,
  scratch,
  activeKind,
  activeDocument,
  activeTerminalId,
  terminalIds,
  documents,
  sessions,
  isEditView,
  launchContext,
  engageTab,
  cancelRestoration,
  rememberPendingTerminalRef,
}: {
  bucket: string | null;
  projectId: string | null;
  moduleId: string | null;
  owner: ForegroundOwner;
  scratch: boolean;
  activeKind: TabKind;
  activeDocument: DesignDoc | null;
  activeTerminalId: string | null;
  terminalIds: readonly string[];
  documents: readonly DesignDoc[];
  sessions: Readonly<Record<string, SessionMeta>>;
  isEditView: boolean;
  launchContext: WorkspaceLauncherContext | null;
  engageTab: (tab: TaskWorkspaceTabIdentity) => void;
  cancelRestoration: () => void;
  rememberPendingTerminalRef: MutableRefObject<boolean>;
}) {
  const setActive = useTicketWorkspaceStore((state) => state.setActive);
  const setActiveDoc = useTicketWorkspaceStore((state) => state.setActiveDoc);
  const closeDoc = useTicketWorkspaceStore((state) => state.closeDoc);
  const reopenDoc = useTicketWorkspaceStore((state) => state.reopenDoc);
  const setEditViewZone = useClientStore((state) => state.setEditViewZone);
  const setNavigationModality = useClientStore(
    (state) => state.setNavigationModality,
  );
  const focusSession = useTerminalStore((state) => state.focusSession);
  const openSession = useTerminalStore((state) => state.openSession);
  const [resumingRunId, setResumingRunId] = useState<string | null>(null);

  function selectWorkspaceTab(tab: TaskWorkspaceTabIdentity): void {
    if (!bucket) return;
    cancelRestoration();
    rememberPendingTerminalRef.current = false;
    if (tab.kind === "details") {
      setActive(bucket, "details");
      if (owner === "studio") {
        rememberStudioWorkspaceTarget(bucket, { kind: "details" });
      }
    } else if (tab.kind === "changes") {
      setActive(bucket, "changes");
      if (owner === "studio") {
        rememberStudioWorkspaceTarget(bucket, { kind: "changes" });
      }
    } else if (tab.kind === "doc") {
      setActiveDoc(bucket, tab.id);
      const relPath = documents.find(
        (document) => document.id === tab.id,
      )?.rel_path;
      if (owner === "studio" && relPath) {
        rememberStudioWorkspaceTarget(bucket, { kind: "doc", relPath });
      }
    } else {
      focusSession(tab.id);
      setActive(bucket, "terminal");
      const agentRunId = sessions[tab.id]?.agentRunId;
      if (owner === "studio" && agentRunId) {
        rememberStudioWorkspaceTarget(bucket, { kind: "terminal", agentRunId });
      } else if (owner === "studio") {
        rememberPendingTerminalRef.current = true;
      }
    }
    if (!isEditView) engageTab(tab);
  }

  function diveWorkspaceTab(
    tab: TaskWorkspaceTabIdentity,
    activate: boolean,
  ): void {
    setEditViewZone("active-tab-body");
    if (activate) selectWorkspaceTab(tab);
  }

  function claimPointerZone(
    zone: "tab-strip" | "active-tab-body",
  ): void {
    setNavigationModality("pointer");
    setEditViewZone(zone);
  }

  function closeWorkspaceDocument(docId: string): void {
    if (!bucket) return;
    const wasActive = activeKind === "doc" && activeDocument?.id === docId;
    closeDoc(bucket, docId);
    if (owner === "studio" && wasActive) {
      rememberStudioWorkspaceTarget(bucket, { kind: "details" });
    }
  }

  function reopenWorkspaceDocument(docId: string): void {
    if (!bucket) return;
    reopenDoc(bucket, docId);
    const relPath = documents.find(
      (document) => document.id === docId,
    )?.rel_path;
    if (owner === "studio" && relPath) {
      rememberStudioWorkspaceTarget(bucket, { kind: "doc", relPath });
    }
  }

  function closeWorkspaceTerminal(sessionId: string): void {
    if (!bucket) return;
    if (
      owner === "studio" &&
      activeKind === "terminal" &&
      activeTerminalId === sessionId
    ) {
      const index = terminalIds.indexOf(sessionId);
      const remaining = terminalIds.filter((id) => id !== sessionId);
      const nextSessionId = remaining[Math.min(index, remaining.length - 1)];
      const agentRunId = nextSessionId
        ? sessions[nextSessionId]?.agentRunId
        : null;
      rememberStudioWorkspaceTarget(
        bucket,
        agentRunId ? { kind: "terminal", agentRunId } : { kind: "details" },
      );
    }
    void closeTerminalTab(sessionId, bucket);
  }

  async function resumeWorkspaceTerminal(
    resumableSession: ResumableTerminalSession,
  ): Promise<void> {
    if (!bucket || !projectId || resumingRunId) return;
    setResumingRunId(resumableSession.agent_run_id);
    try {
      const resumed = await resumeTerminal({
        source: resumableSession,
        projectId,
        moduleId: moduleId ?? "",
        taskId: scratch ? null : bucket,
      });
      const restoredSessionId = useTerminalStore.getState()
        .sessionByRun[resumed.agent_run_id];
      const successorSessionId = restoredSessionId ??
        openSession({
          taskId: scratch ? null : bucket,
          projectId,
          moduleId: moduleId ?? undefined,
          agent: resumableSession.agent,
          agentRunId: resumed.agent_run_id,
          isPlanning: resumableSession.scope === "plan",
          isInstant: resumableSession.scope === "instant",
        });
      focusSession(successorSessionId);
      setActive(bucket, "terminal");
      if (owner === "studio") {
        rememberStudioWorkspaceTarget(bucket, {
          kind: "terminal",
          agentRunId: resumed.agent_run_id,
        });
      }
    } catch (error) {
      toast.error(resumeErrorMessage(error));
    } finally {
      setResumingRunId(null);
    }
  }

  function launchTaskAgent(
    agent: SessionMeta["agent"],
    context: TicketLaunchContext,
  ): void {
    if (!bucket || !launchContext || launchContext.kind !== "task") return;
    openSession({
      taskId: context.taskId,
      projectId: context.projectId,
      moduleId: context.moduleId ?? undefined,
      agent,
    });
    setActive(bucket, "terminal");
    if (owner === "studio") rememberPendingTerminalRef.current = true;
  }

  return {
    selectWorkspaceTab,
    diveWorkspaceTab,
    claimPointerZone,
    closeWorkspaceDocument,
    reopenWorkspaceDocument,
    closeWorkspaceTerminal,
    resumeWorkspaceTerminal,
    launchTaskAgent,
    resumingRunId,
  };
}
