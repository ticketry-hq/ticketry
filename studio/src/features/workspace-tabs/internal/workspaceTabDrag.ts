import type { DragPayloadCodec } from "../../../shared/dragDrop/useAxisDragAndDrop";
import type { WorkspaceTabIdentity } from "../types";

function isWorkspaceTabIdentity(value: unknown): value is WorkspaceTabIdentity {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  const identity = value as { kind?: unknown; id?: unknown };
  if (identity.kind === "details") return identity.id === undefined;
  return (
    (identity.kind === "doc" || identity.kind === "terminal") &&
    typeof identity.id === "string" &&
    identity.id.length > 0
  );
}

export const workspaceTabDragCodec: DragPayloadCodec<WorkspaceTabIdentity> = {
  type: "application/x-ticketry-workspace-tab",
  serialize: JSON.stringify,
  deserialize(serialized) {
    try {
      const value: unknown = JSON.parse(serialized);
      return isWorkspaceTabIdentity(value) ? value : null;
    } catch {
      return null;
    }
  },
};
