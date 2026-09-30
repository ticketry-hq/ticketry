export async function resolveReleaseCommit(environment, capture, { allowDirty = false } = {}) {
  const status = await capture(
    "git",
    ["status", "--porcelain", "--untracked-files=normal"],
    "release source cleanliness check",
  );
  if (!allowDirty && status.trim()) throw new Error("release source tree is dirty");

  const head = await capture("git", ["rev-parse", "HEAD"], "release commit resolution");
  const resolved = environment.TICKETRY_COMMIT ?? head;
  const commit = typeof resolved === "string" ? resolved.trim() : "";
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(commit)) {
    throw new Error("release commit must be a full Git object ID");
  }
  if (environment.TICKETRY_COMMIT && commit.toLowerCase() !== head.trim().toLowerCase()) {
    throw new Error("explicit release commit does not match HEAD");
  }
  return head.trim();
}
