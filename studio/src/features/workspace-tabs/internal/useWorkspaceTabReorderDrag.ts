import { useCallback, useEffect, useRef } from "react";
import {
  useAxisDragAndDrop,
  type DragSourceProps,
  type DropIntent,
  type DropTargetProps,
} from "../../../shared/dragDrop/useAxisDragAndDrop";
import {
  prepareWorkspaceTabOrderWrite,
  reorderVisibleWorkspaceTabs,
  workspaceTabIdentityKey,
} from "../ordering";
import { useReorderWorkspaceTabs } from "../mutations";
import type { WorkspaceTabOrderQuery } from "../queries";
import type { WorkspaceTabIdentity } from "../types";
import { workspaceTabDragCodec } from "./workspaceTabDrag";

export interface WorkspaceTabReorderDrag {
  readonly isPending: boolean;
  readonly dropIntentFor: (identity: WorkspaceTabIdentity) => DropIntent | null;
  readonly dragSourcePropsFor: (identity: WorkspaceTabIdentity) => DragSourceProps;
  readonly dropTargetPropsFor: (identity: WorkspaceTabIdentity) => DropTargetProps;
  /**
   * True when this activation is the browser's click at the end of a drag
   * rather than a new user gesture. Pass the activating event so keyboard
   * activation, which carries no pointer detail, is never suppressed.
   */
  readonly consumePostDropClick: (event?: { detail: number }) => boolean;
}

export function useWorkspaceTabReorderDrag({
  workItemId,
  visibleOrder,
  savedOrder,
  knownIdentities,
  toPersistentIdentity,
}: {
  workItemId: string | null;
  visibleOrder: readonly WorkspaceTabIdentity[];
  savedOrder: WorkspaceTabOrderQuery;
  knownIdentities: readonly WorkspaceTabIdentity[];
  toPersistentIdentity: (identity: WorkspaceTabIdentity) => WorkspaceTabIdentity;
}): WorkspaceTabReorderDrag {
  const { reorder, isPending } = useReorderWorkspaceTabs(workItemId);
  /* Set at the drop, cleared by the next pointer gesture — the drag's own
     trailing click lands in between, and nothing else does. */
  const dropEcho = useRef(false);

  useEffect(() => {
    const clearEcho = () => {
      dropEcho.current = false;
    };
    document.addEventListener("pointerdown", clearEcho, true);
    return () => document.removeEventListener("pointerdown", clearEcho, true);
  }, []);

  const handleDrop = useCallback(
    (
      source: WorkspaceTabIdentity,
      resolved: { targetId: string; intent: DropIntent },
    ) => {
      dropEcho.current = true;
      if (!savedOrder.isReady) return;
      const target = visibleOrder.find(
        (identity) => workspaceTabIdentityKey(identity) === resolved.targetId,
      );
      if (!target) return;
      const nextVisible = reorderVisibleWorkspaceTabs(
        visibleOrder,
        source,
        target,
        resolved.intent,
      );
      if (!nextVisible) return;
      reorder(prepareWorkspaceTabOrderWrite(
        nextVisible.map(toPersistentIdentity),
        savedOrder.order,
        knownIdentities,
      ));
    },
    [knownIdentities, reorder, savedOrder, toPersistentIdentity, visibleOrder],
  );

  const dragDrop = useAxisDragAndDrop<WorkspaceTabIdentity, string>({
    axis: "horizontal",
    codec: workspaceTabDragCodec,
    disabled: !savedOrder.isReady || isPending || workItemId === null,
    onDrop: handleDrop,
  });

  const dropIntentFor = useCallback(
    (identity: WorkspaceTabIdentity) => {
      const key = workspaceTabIdentityKey(identity);
      return dragDrop.targetId === key &&
        dragDrop.payload !== null &&
        workspaceTabIdentityKey(dragDrop.payload) !== key
        ? dragDrop.intent
        : null;
    },
    [dragDrop.intent, dragDrop.payload, dragDrop.targetId],
  );
  const dragSourcePropsFor = useCallback(
    (identity: WorkspaceTabIdentity) => dragDrop.getDragSourceProps(identity),
    [dragDrop.getDragSourceProps],
  );
  const dropTargetPropsFor = useCallback(
    (identity: WorkspaceTabIdentity) =>
      dragDrop.getDropTargetProps(workspaceTabIdentityKey(identity)),
    [dragDrop.getDropTargetProps],
  );
  const consumePostDropClick = useCallback((event?: { detail: number }) => {
    if (!dropEcho.current || (event?.detail ?? 0) === 0) return false;
    dropEcho.current = false;
    return true;
  }, []);

  return {
    isPending,
    dropIntentFor,
    dragSourcePropsFor,
    dropTargetPropsFor,
    consumePostDropClick,
  };
}
