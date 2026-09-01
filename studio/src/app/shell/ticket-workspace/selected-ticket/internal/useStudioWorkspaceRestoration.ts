import {
  useCallback,
  useEffect,
  useRef,
  type MutableRefObject,
} from "react";
import {
  bucketOfMeta,
  useTerminalStore,
  useWorkspaceTabsStore,
  type ForegroundOwner,
  type SessionMeta,
} from "../../../../../features/agents/terminal";
import type { TaskWorkspaceTabIdentity } from "./useTaskWorkspaceTabNavigation";
import type { DesignDoc } from "../../../../../features/agents/types";
import type { TabKind } from "../../../../../features/agents/types";
import {
  readStudioWorkspaceTarget,
  rememberStudioWorkspaceTarget,
  type StudioWorkspaceTarget,
} from "./studioWorkspaceTarget";

export function useStudioWorkspaceRestoration({
  bucket,
  owner,
  setActive,
  requestedSurfaceRef,
  requestedTerminalRef,
  rememberPendingTerminalRef,
  explicitTerminalRunId = null,
}: {
  bucket: string | null;
  owner: ForegroundOwner;
  setActive: (bucket: string, active: TabKind) => void;
  requestedSurfaceRef: MutableRefObject<TaskWorkspaceTabIdentity | null>;
  requestedTerminalRef: MutableRefObject<string | null>;
  rememberPendingTerminalRef: MutableRefObject<boolean>;
  /**
   * The run this workspace was entered for, when the caller already chose one
   * (clicking a Conversations row). Durable restoration must not override it.
   */
  explicitTerminalRunId?: string | null;
}) {
  const restoreRequestRef = useRef<{
    bucket: string;
    generation: number;
    target: StudioWorkspaceTarget;
  } | null>(null);
  const restoreGenerationRef = useRef(0);
  // Read at effect time, not through the dependency list: the durable target
  // is restored once per bucket entry, so a later change of the live selection
  // must not re-run restoration and clobber it.
  const explicitTerminalRunIdRef = useRef(explicitTerminalRunId);
  explicitTerminalRunIdRef.current = explicitTerminalRunId;

  useEffect(() => {
    const generation = ++restoreGenerationRef.current;
    requestedSurfaceRef.current = null;
    requestedTerminalRef.current = null;
    rememberPendingTerminalRef.current = false;
    restoreRequestRef.current = null;
    if (!bucket || owner !== "studio") return;
    // Entering the workspace already focused on one conversation is the live
    // instruction; restoring the remembered surface over it is what made
    // selecting a conversation take a second click.
    if (explicitTerminalRunIdRef.current) return;
    const target = readStudioWorkspaceTarget(bucket);
    if (!target) return;
    // Keep Details visible while durable targets hydrate.
    restoreRequestRef.current = { bucket, generation, target };
    setActive(bucket, "details");
    if (target.kind === "details" || target.kind === "changes") {
      restoreRequestRef.current = null;
      setActive(bucket, target.kind);
    }
  }, [
    bucket,
    owner,
    rememberPendingTerminalRef,
    requestedSurfaceRef,
    requestedTerminalRef,
    setActive,
  ]);

  const restoreTerminalTarget = useCallback(
    (
      expectedBucket: string,
      generation: number,
      fallbackWhenMissing: boolean,
    ): void => {
      const request = restoreRequestRef.current;
      if (
        owner !== "studio" ||
        request?.bucket !== expectedBucket ||
        request.generation !== generation ||
        request.target.kind !== "terminal"
      ) {
        return;
      }
      const sessionId = useTerminalStore.getState().sessionByRun[
        request.target.agentRunId
      ];
      const session = sessionId
        ? useTerminalStore.getState().sessions[sessionId]
        : null;
      if (session && bucketOfMeta(session) === expectedBucket) {
        restoreRequestRef.current = null;
        useWorkspaceTabsStore.getState().tabSelected(expectedBucket, sessionId);
        setActive(expectedBucket, "terminal");
        return;
      }
      if (!fallbackWhenMissing) return;
      restoreRequestRef.current = null;
      setActive(expectedBucket, "details");
      rememberStudioWorkspaceTarget(expectedBucket, { kind: "details" });
    },
    [owner, setActive],
  );

  return {
    restoreRequestRef,
    restoreGenerationRef,
    restoreTerminalTarget,
  };
}

export function useStudioDocumentRestoration({
  bucket,
  owner,
  documents,
  documentsFetched,
  restoreRequestRef,
  restoreGenerationRef,
  setActive,
  setActiveDoc,
}: {
  bucket: string | null;
  owner: ForegroundOwner;
  documents: readonly DesignDoc[];
  documentsFetched: boolean;
  restoreRequestRef: MutableRefObject<{
    bucket: string;
    generation: number;
    target: StudioWorkspaceTarget;
  } | null>;
  restoreGenerationRef: MutableRefObject<number>;
  setActive: (bucket: string, active: "details") => void;
  setActiveDoc: (bucket: string, documentId: string) => void;
}): void {
  useEffect(() => {
    if (!bucket || !documentsFetched) return;
    const request = restoreRequestRef.current;
    if (
      owner !== "studio" ||
      request?.bucket !== bucket ||
      request.generation !== restoreGenerationRef.current ||
      request.target.kind !== "doc"
    ) {
      return;
    }
    const relPath = request.target.relPath;
    const target = documents.find(
      (document) => document.rel_path === relPath,
    );
    restoreRequestRef.current = null;
    if (target) setActiveDoc(bucket, target.id);
    else {
      setActive(bucket, "details");
      rememberStudioWorkspaceTarget(bucket, { kind: "details" });
    }
  }, [
    bucket,
    documents,
    documentsFetched,
    owner,
    restoreGenerationRef,
    restoreRequestRef,
    setActive,
    setActiveDoc,
  ]);
}

export function useRememberPendingTerminalTarget({
  bucket,
  owner,
  activeTerminalId,
  sessions,
  rememberPendingTerminalRef,
}: {
  bucket: string | null;
  owner: ForegroundOwner;
  activeTerminalId: string | null;
  sessions: Readonly<Record<string, SessionMeta>>;
  rememberPendingTerminalRef: MutableRefObject<boolean>;
}): void {
  useEffect(() => {
    if (
      owner !== "studio" ||
      !bucket ||
      !rememberPendingTerminalRef.current ||
      !activeTerminalId
    ) {
      return;
    }
    const agentRunId = sessions[activeTerminalId]?.agentRunId;
    if (!agentRunId) return;
    // Persist after the launched session gains durable identity.
    rememberPendingTerminalRef.current = false;
    rememberStudioWorkspaceTarget(bucket, { kind: "terminal", agentRunId });
  }, [
    activeTerminalId,
    bucket,
    owner,
    rememberPendingTerminalRef,
    sessions,
  ]);
}
