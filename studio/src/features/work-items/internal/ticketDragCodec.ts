import type { DragPayloadCodec } from "../../../shared/dragDrop/useAxisDragAndDrop";

export interface TicketDragPayload {
  taskId: string;
}

export const stateDropTargetId = (stateId: string) => `state:${stateId}`;

export const ticketDragCodec: DragPayloadCodec<TicketDragPayload> = {
  type: "application/x-ticketry-workflow-ticket",
  serialize: JSON.stringify,
  deserialize(serialized) {
    try {
      const value = JSON.parse(serialized) as unknown;
      return value &&
        typeof value === "object" &&
        typeof (value as { taskId?: unknown }).taskId === "string"
        ? { taskId: (value as { taskId: string }).taskId }
        : null;
    } catch {
      return null;
    }
  },
};

