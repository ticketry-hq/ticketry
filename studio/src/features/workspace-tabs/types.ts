export type WorkspaceTabIdentity =
  | { kind: "details" }
  | { kind: "doc"; id: string }
  | { kind: "terminal"; id: string };

export interface WorkspaceTabOrder {
  readonly order: readonly WorkspaceTabIdentity[];
}

function parseIdentity(value: unknown): WorkspaceTabIdentity | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { kind?: unknown; id?: unknown };
  if (candidate.kind === "details") {
    return candidate.id === undefined ? { kind: "details" } : null;
  }
  if (
    (candidate.kind === "doc" || candidate.kind === "terminal") &&
    typeof candidate.id === "string" &&
    candidate.id.length > 0
  ) {
    return { kind: candidate.kind, id: candidate.id };
  }
  return null;
}

/** Narrow the generated JSON scalar to the server's validated identity list. */
export function workspaceTabOrderFromJson(value: unknown): WorkspaceTabOrder {
  if (!Array.isArray(value)) return { order: [] };
  const order: WorkspaceTabIdentity[] = [];
  const keys = new Set<string>();
  for (const valueIdentity of value) {
    const identity = parseIdentity(valueIdentity);
    if (!identity) return { order: [] };
    const key = identity.kind === "details"
      ? "details"
      : `${identity.kind}:${identity.id}`;
    if (keys.has(key)) return { order: [] };
    keys.add(key);
    order.push(identity);
  }
  return { order };
}
