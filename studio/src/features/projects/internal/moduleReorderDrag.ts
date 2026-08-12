import { useCallback, useRef } from "react";
import {
  useAxisDragAndDrop,
  type DragAxis,
  type DragSourceProps,
  type DropIntent,
  type DropTargetProps,
} from "../../../shared/dragDrop/useAxisDragAndDrop";
import { useReorderModule } from "../mutations";
import { moduleDragCodec, type ModuleDragPayload } from "./moduleDrag";

/**
 * A browser may emit a click on the element a drag finished over. Selecting a
 * Module because it was dropped on would be a surprise, so a click arriving
 * this soon after a drop is ignored — long enough to cover the synthetic
 * click, far short of a deliberate second gesture.
 */
const POST_DROP_CLICK_WINDOW_MS = 300;

export interface ModuleReorderDrag {
  /** True while a reorder is in flight; drag sources stay disabled until it settles. */
  readonly isPending: boolean;
  /** The insertion edge to draw on this Module, or null when it is not the target. */
  readonly dropIntentFor: (moduleId: string) => DropIntent | null;
  readonly dragSourcePropsFor: (moduleId: string) => DragSourceProps;
  readonly dropTargetPropsFor: (moduleId: string) => DropTargetProps;
  /**
   * True when the click now arriving is the browser's post-drop echo and the
   * caller should not treat it as a selection. Consumes the suppression, so a
   * genuine click immediately afterwards still selects.
   */
  readonly consumePostDropClick: () => boolean;
}

/**
 * One Module reorder gesture, on whichever axis the surface lays its Modules
 * out (#361).
 *
 * The sidebar drags vertically and the Module tab strip horizontally, but a
 * Module is one project-owned thing and a drag of it means the same thing on
 * either surface. Both therefore share this hook rather than each wiring the
 * drag controller to the mutation themselves: payload validation, midpoint
 * near/far resolution, cancellation cleanup, pending-state disablement, and the
 * optimistic-update/rollback/retry write are then necessarily identical, and
 * cannot drift apart as one surface is changed.
 */
export function useModuleReorderDrag(
  projectId: string | null,
  axis: DragAxis,
): ModuleReorderDrag {
  const { reorder, isPending } = useReorderModule(projectId);
  const droppedAt = useRef(0);

  const handleDrop = useCallback(
    (
      payload: ModuleDragPayload,
      resolved: { targetId: string; intent: DropIntent },
    ) => {
      droppedAt.current = Date.now();
      reorder(payload.moduleId, resolved.targetId, resolved.intent);
    },
    [reorder],
  );

  const dragDrop = useAxisDragAndDrop<ModuleDragPayload, string>({
    axis,
    codec: moduleDragCodec,
    // One gesture at a time: a second drag cannot start against an order the
    // server has not yet agreed to.
    disabled: isPending || projectId === null,
    onDrop: handleDrop,
  });

  const { getDragSourceProps, getDropTargetProps, intent, payload, targetId } =
    dragDrop;

  const dropIntentFor = useCallback(
    (moduleId: string) =>
      // A Module is never its own drop target: dropping it back on itself
      // cannot move it, so there is no edge to promise.
      targetId === moduleId && payload !== null && payload.moduleId !== moduleId
        ? intent
        : null,
    [intent, payload, targetId],
  );

  const dragSourcePropsFor = useCallback(
    (moduleId: string) => getDragSourceProps({ moduleId }),
    [getDragSourceProps],
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
    dropTargetPropsFor: getDropTargetProps,
    consumePostDropClick,
  };
}
