import type { WorkspaceTabIdentity } from "./types";

export function workspaceTabIdentityKey(identity: WorkspaceTabIdentity): string {
  return identity.kind === "details" || identity.kind === "changes"
    ? identity.kind
    : `${identity.kind}:${identity.id}`;
}

/** Move one visible tab to the resolved edge of another visible tab. */
export function reorderVisibleWorkspaceTabs(
  order: readonly WorkspaceTabIdentity[],
  source: WorkspaceTabIdentity,
  target: WorkspaceTabIdentity,
  intent: "near" | "far",
): WorkspaceTabIdentity[] | null {
  const sourceKey = workspaceTabIdentityKey(source);
  const targetKey = workspaceTabIdentityKey(target);
  if (sourceKey === targetKey) return null;

  const sourceIndex = order.findIndex(
    (identity) => workspaceTabIdentityKey(identity) === sourceKey,
  );
  if (sourceIndex === -1) return null;

  const remaining = order.filter(
    (identity) => workspaceTabIdentityKey(identity) !== sourceKey,
  );
  const targetIndex = remaining.findIndex(
    (identity) => workspaceTabIdentityKey(identity) === targetKey,
  );
  if (targetIndex === -1) return null;

  const next = [...remaining];
  next.splice(intent === "near" ? targetIndex : targetIndex + 1, 0, order[sourceIndex]);
  if (
    next.every(
      (identity, index) =>
        workspaceTabIdentityKey(identity) ===
        workspaceTabIdentityKey(order[index]),
    )
  ) {
    return null;
  }
  return next;
}

/** Apply saved precedence, then append newly visible tabs in default order. */
export function orderVisibleWorkspaceTabs(
  visible: readonly WorkspaceTabIdentity[],
  saved: readonly WorkspaceTabIdentity[],
): WorkspaceTabIdentity[] {
  const visibleByKey = new Map(
    visible.map((identity) => [workspaceTabIdentityKey(identity), identity]),
  );
  const ordered: WorkspaceTabIdentity[] = [];
  const included = new Set<string>();

  for (const identity of saved) {
    const key = workspaceTabIdentityKey(identity);
    const current = visibleByKey.get(key);
    if (!current || included.has(key)) continue;
    included.add(key);
    ordered.push(current);
  }
  for (const identity of visible) {
    const key = workspaceTabIdentityKey(identity);
    if (included.has(key)) continue;
    included.add(key);
    ordered.push(identity);
  }
  return ordered;
}

/**
 * Build the next durable order after a visible reorder. Known hidden tabs keep
 * their saved slots; unknown stale tabs are pruned.
 */
export function prepareWorkspaceTabOrderWrite(
  visibleOrder: readonly WorkspaceTabIdentity[],
  savedOrder: readonly WorkspaceTabIdentity[],
  knownIdentities: readonly WorkspaceTabIdentity[],
): WorkspaceTabIdentity[] {
  const visibleKeys = new Set(visibleOrder.map(workspaceTabIdentityKey));
  const knownKeys = new Set(knownIdentities.map(workspaceTabIdentityKey));
  const pendingVisible = [...visibleOrder];
  const next: WorkspaceTabIdentity[] = [];

  for (const saved of savedOrder) {
    const key = workspaceTabIdentityKey(saved);
    if (!knownKeys.has(key)) continue;
    if (visibleKeys.has(key)) {
      const replacement = pendingVisible.shift();
      if (replacement) next.push(replacement);
    } else {
      next.push(saved);
    }
  }
  next.push(...pendingVisible);
  return next;
}
