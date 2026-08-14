import type { DragPayloadCodec } from "../../../shared/dragDrop/useAxisDragAndDrop";

/**
 * The drag payload every Module reorder surface speaks (#360).
 *
 * The sidebar drags vertically and the Module tab strip horizontally, but both
 * move the same project-owned Module, so they share one payload type and one
 * codec. A distinct transfer type is what stops a story drag — or anything
 * dropped in from outside Studio — from being read as a Module move.
 */
export interface ModuleDragPayload {
  moduleId: string;
}

export const moduleDragCodec: DragPayloadCodec<ModuleDragPayload> = {
  type: "application/x-ticketry-module",
  serialize: JSON.stringify,
  deserialize(serialized) {
    try {
      const value = JSON.parse(serialized) as unknown;
      return value &&
        typeof value === "object" &&
        typeof (value as { moduleId?: unknown }).moduleId === "string"
        ? { moduleId: (value as { moduleId: string }).moduleId }
        : null;
    } catch {
      return null;
    }
  },
};
