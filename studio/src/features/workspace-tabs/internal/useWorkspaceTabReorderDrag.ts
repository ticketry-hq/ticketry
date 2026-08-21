import { useCallback, useRef } from "react";
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

const POST_DROP_CLICK_WINDOW_MS = 300;

export interface WorkspaceTabReorderDrag {
  readonly isPending: boolean;
  readonly dropIntentFor: (identity: WorkspaceTabIdentity) => DropIntent | null;
  readonly dragSourcePropsFor: (identity: WorkspaceTabIdentity) => DragSourceProps;
  readonly dropTargetPropsFor: (identity: WorkspaceTabIdentity) => DropTargetProps;
  readonly consumePostDropClick: () => boolean;
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
  const droppedAt = useRef(0);

  const handleDrop = useCallback(
    (
      source: WorkspaceTabIdentity,
      resolved: { targetId: string; intent: DropIntent },
    ) => {
      droppedAt.current = Date.now();
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
      const completeOrder = prepareWorkspaceTabOrderWrite(
        nextVisible.map(toPersistentIdentity),
        savedOrder.order,
        knownIdentities,
      );
      reorder(completeOrder, savedOrder);
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
  const consumePostDropClick = useCallback(() => {
    if (Date.now() - droppedAt.current >= POST_DROP_CLICK_WINDOW_MS) return false;
    droppedAt.current = 0;
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
