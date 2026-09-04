/**
 * Viewer-lease failures reach the terminal client through several error
 * shapes. `graphQlMutationError` rethrows a `FoundationGraphQlError` as an
 * `ApiError` whose domain code lives at `body.code`, the raw Apollo error
 * carries it at `code`, and a Tauri command rejection is a plain object with
 * `code`. Reading only one of those silently loses ownership loss, so the
 * lookup lives here and every lease caller uses it.
 */

/** The domain code carried by a lease failure, whatever shape it arrived in. */
export function viewerLeaseFailureCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const direct = readCode(error);
  if (direct) return direct;
  const body = (error as { body?: unknown }).body;
  if (body && typeof body === "object") {
    const nested = readCode(body);
    if (nested) return nested;
  }
  return null;
}

/**
 * Another viewer holds the lease, or this viewer's grant is no longer
 * recognised. Both mean this client must stop acting as the owning viewer.
 */
export function isViewerLeaseLost(error: unknown): boolean {
  const code = viewerLeaseFailureCode(error);
  return code === "replaced_by_another_viewer" || code === "viewer_lease_not_owned";
}

function readCode(value: object): string | null {
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" && code ? code : null;
}
