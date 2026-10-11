import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
} from "react";
import {
  bucketOfMeta,
  useTerminalStore,
  useWorkspaceTabsStore,
  type ForegroundOwner,
} from "../../agents/terminal";
import type { TaskWorkspaceTabIdentity } from "./useTaskWorkspaceTabNavigation";
import type { PendingTerminalTarget } from "./useRememberPendingTerminalTarget";
import type { DesignDoc } from "../../agents/types";
import type { TabKind } from "../../agents/types";
import {
  readStudioWorkspaceTarget,
  rememberStudioWorkspaceTarget,
  type StudioWorkspaceTarget,
} from "../../workspace-state/studioWorkspaceTarget";

function sameTarget(left: StudioWorkspaceTarget | null, right: StudioWorkspaceTarget): boolean {
  if (left?.kind !== right.kind) return false;
  if (left.kind === "doc" && right.kind === "doc") return left.relPath === right.relPath;
  if (left.kind === "terminal" && right.kind === "terminal") return left.agentRunId === right.agentRunId;
  return true;
}

export function useStudioWorkspaceRestoration({
  bucket,
  projectId,
  moduleId,
  owner,
  setActive,
  requestedSurfaceRef,
  requestedTerminalRef,
  rememberPendingTerminalRef,
  excludedRunIds,
  workspaceActive,
  explicitTerminalRunId = null,
}: {
  bucket: string | null;
  projectId: string | null;
  moduleId: string | null;
  owner: ForegroundOwner;
  setActive: (bucket: string, active: TabKind) => void;
  requestedSurfaceRef: MutableRefObject<TaskWorkspaceTabIdentity | null>;
  requestedTerminalRef: MutableRefObject<string | null>;
  rememberPendingTerminalRef: MutableRefObject<PendingTerminalTarget | null>;
  excludedRunIds: ReadonlySet<string>;
  workspaceActive: boolean;
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
  const cancelRestoration = useCallback(() => {
    ++restoreGenerationRef.current;
    restoreRequestRef.current = null;
    requestedSurfaceRef.current = null;
    requestedTerminalRef.current = null;
    rememberPendingTerminalRef.current = null;
  }, [rememberPendingTerminalRef, requestedSurfaceRef, requestedTerminalRef]);

  // Every UI completion shares restoration's private entry/explicit-intent epoch.
  const captureIntent = useCallback(() => {
    const generation = restoreGenerationRef.current;
    return () => generation === restoreGenerationRef.current;
  }, []);

  const isCurrentRestoration = useCallback((expectedBucket: string, generation: number) => {
    const request = restoreRequestRef.current;
    if (request?.bucket !== expectedBucket || request.generation !== generation ||
      generation !== restoreGenerationRef.current) return false;
    // External run-navigation actions publish their explicit durable target
    // before selecting it. Honor that intent without replaying restoration.
    if (!sameTarget(readStudioWorkspaceTarget(expectedBucket), request.target)) {
      cancelRestoration();
      return false;
    }
    return true;
  }, [cancelRestoration]);

  // Invalidate the previous entry before hydration/reconciliation can commit.
  // Cleanup also distinguishes A→B→A, retained visibility reentry and disposal.
  // Hidden workspaces may hydrate selection (including scratch startup), but
  // presentation changes invalidate action completion and create a fresh epoch.
  useLayoutEffect(() => {
    cancelRestoration();
    const generation = restoreGenerationRef.current;
    if (!bucket || owner !== "studio") return cancelRestoration;
    // Entering the workspace already focused on one conversation is the live
    // instruction; restoring the remembered surface over it is what made
    // selecting a conversation take a second click.
    if (explicitTerminalRunId) {
      rememberStudioWorkspaceTarget(bucket, {
        kind: "terminal", agentRunId: explicitTerminalRunId,
      });
      return cancelRestoration;
    }
    const target = readStudioWorkspaceTarget(bucket);
    if (!target) return cancelRestoration;
    // Keep Details visible while durable targets hydrate.
    restoreRequestRef.current = { bucket, generation, target };
    setActive(bucket, "details");
    if (target.kind === "details" || target.kind === "changes") {
      restoreRequestRef.current = null;
      setActive(bucket, target.kind);
    }
    return cancelRestoration;
  }, [
    bucket,
    projectId,
    moduleId,
    owner,
    explicitTerminalRunId,
    workspaceActive,
    cancelRestoration,
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
        !isCurrentRestoration(expectedBucket, generation) ||
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
      if (
        session &&
        session.agentRunId === request.target.agentRunId &&
        bucketOfMeta(session) === expectedBucket &&
        !excludedRunIds.has(request.target.agentRunId)
      ) {
        // A known session can be selected before paint, but late eligibility
        // reads may still exclude it. Keep validation pending until resolved.
        if (fallbackWhenMissing) restoreRequestRef.current = null;
        useWorkspaceTabsStore.getState().tabSelected(expectedBucket, sessionId);
        setActive(expectedBucket, "terminal");
        return;
      }
      if (!fallbackWhenMissing) return;
      restoreRequestRef.current = null;
      setActive(expectedBucket, "details");
      rememberStudioWorkspaceTarget(expectedBucket, { kind: "details" });
    },
    [excludedRunIds, isCurrentRestoration, owner, setActive],
  );

  return {
    restoreRequestRef,
    restoreGenerationRef,
    restoreTerminalTarget,
    cancelRestoration,
    isCurrentRestoration,
    captureIntent,
  };
}

export function useStudioDocumentRestoration({
  bucket,
  owner,
  documents,
  documentsFetched,
  restoreRequestRef,
  restoreGenerationRef,
  isCurrentRestoration,
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
  isCurrentRestoration: (bucket: string, generation: number) => boolean;
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
      !isCurrentRestoration(bucket, request.generation) ||
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
    isCurrentRestoration,
    restoreGenerationRef,
    restoreRequestRef,
    setActive,
    setActiveDoc,
  ]);
}

