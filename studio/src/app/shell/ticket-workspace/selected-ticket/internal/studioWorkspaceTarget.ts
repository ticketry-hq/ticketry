// Versioned key (client-localstorage-schema): bump the suffix on shape
// changes and migrate in readStudioWorkspacesValue.
const STUDIO_WORKSPACES_KEY = "studio.activeWorkspaceByBucket:v1";
const LEGACY_STUDIO_WORKSPACES_KEYS = [
  "studio.studio.activeWorkspaceByBucket",
  "studio.coding.activeWorkspaceByBucket",
];

// One entry per work-item bucket ever opened would grow forever; keep the
// most recently touched entries only.
const MAX_WORKSPACE_ENTRIES = 100;

export type StudioWorkspaceTarget =
  | { kind: "details" }
  | { kind: "changes" }
  | { kind: "doc"; relPath: string }
  | { kind: "terminal"; agentRunId: string };

function parseStudioWorkspaceTarget(
  value: unknown,
): StudioWorkspaceTarget | null {
  if (!value || typeof value !== "object") return null;
  const target = value as Record<string, unknown>;
  if (target.kind === "details") return { kind: "details" };
  if (target.kind === "changes") return { kind: "changes" };
  if (target.kind === "doc" && typeof target.relPath === "string") {
    return { kind: "doc", relPath: target.relPath };
  }
  if (target.kind === "terminal" && typeof target.agentRunId === "string") {
    return { kind: "terminal", agentRunId: target.agentRunId };
  }
  return null;
}

function readStudioWorkspacesValue(): string {
  const current = localStorage.getItem(STUDIO_WORKSPACES_KEY);
  if (current !== null) return current;
  for (const legacyKey of LEGACY_STUDIO_WORKSPACES_KEYS) {
    const legacy = localStorage.getItem(legacyKey);
    if (legacy !== null) {
      localStorage.setItem(STUDIO_WORKSPACES_KEY, legacy);
      localStorage.removeItem(legacyKey);
      return legacy;
    }
  }
  return "{}";
}

export function readStudioWorkspaceTarget(
  bucket: string,
): StudioWorkspaceTarget | null {
  try {
    const parsed = JSON.parse(readStudioWorkspacesValue());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parseStudioWorkspaceTarget(
      (parsed as Record<string, unknown>)[bucket],
    );
  } catch {
    return null;
  }
}

export function rememberStudioWorkspaceTarget(
  bucket: string,
  target: StudioWorkspaceTarget,
): void {
  try {
    const parsed = JSON.parse(readStudioWorkspacesValue());
    const current =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    // Re-insert the touched bucket last (insertion order = recency), then
    // drop the oldest entries beyond the cap.
    delete current[bucket];
    const entries = [...Object.entries(current), [bucket, target] as const];
    localStorage.setItem(
      STUDIO_WORKSPACES_KEY,
      JSON.stringify(
        Object.fromEntries(entries.slice(-MAX_WORKSPACE_ENTRIES)),
      ),
    );
  } catch {}
}
