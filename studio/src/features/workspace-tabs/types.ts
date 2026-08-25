import { WorkspaceTabIdentityKindEnum as ApiWorkspaceTabIdentityKind } from "@worktracker/typescript-sdk";
import type { WorkspaceTabOrder as ApiWorkspaceTabOrder } from "../../shared/api/types";

export type WorkspaceTabIdentity =
  | { kind: "details" }
  | { kind: "changes" }
  | { kind: "doc"; id: string }
  | { kind: "terminal"; id: string };

/** Tabs the workspace owns itself, so they carry no record id. */
export function isPinnedWorkspaceTab(
  identity: WorkspaceTabIdentity,
): identity is { kind: "details" } | { kind: "changes" } {
  return identity.kind === "details" || identity.kind === "changes";
}

export interface WorkspaceTabOrder {
  order: WorkspaceTabIdentity[];
}

export function workspaceTabOrderToApi(
  value: WorkspaceTabOrder,
): ApiWorkspaceTabOrder {
  return {
    order: value.order.map((identity) => ({
      ...identity,
      kind: ApiWorkspaceTabIdentityKind[identity.kind],
    })),
  };
}

/** Narrow the generated transport shape to Studio's discriminated identity. */
export function workspaceTabOrderFromApi(
  value: ApiWorkspaceTabOrder,
): WorkspaceTabOrder {
  const order: WorkspaceTabIdentity[] = [];
  for (const identity of value.order) {
    if (identity.kind === "details" || identity.kind === "changes") {
      order.push({ kind: identity.kind });
    } else if (identity.id) {
      order.push({ kind: identity.kind, id: identity.id });
    }
  }
  return { order };
}
