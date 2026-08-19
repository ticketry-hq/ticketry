/**
 * Window-session record of the user notices Studio has already presented.
 *
 * The desktop host retains every notice for the life of the application and
 * replays them through the startup configuration on every document load, so a
 * genuinely fresh window still sees them. Recovery policies, however, refresh
 * the WebView without the user asking — those refreshes are meant to be
 * invisible, and replaying an already-acknowledged notice after one gives the
 * refresh away. Session storage has exactly the wanted lifetime: it survives an
 * in-app refresh and dies with the window, so each notice is presented once per
 * app run, at startup, and never again on a recovery reload.
 *
 * Only the schema version and the presented ids are stored. Anything else in
 * the slot is somebody else's data or an obsolete shape, and reads as nothing
 * having been presented — the worst case is one repeated notice, never a
 * swallowed one.
 */

const STORAGE_KEY = "ticketry.modal.presentedNotices";

/** Bumped whenever the persisted shape changes; older records reset safely. */
const SCHEMA_VERSION = 1;

function storage(): Storage | null {
  try {
    return window.sessionStorage ?? null;
  } catch {
    // Storage can be denied outright (private modes, hardened WebViews).
    // Notices still present; they just repeat across refreshes.
    return null;
  }
}

/** The ids of notices this window session has already presented. */
export function readPresentedNoticeIds(): string[] {
  const raw = (() => {
    try {
      return storage()?.getItem(STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  })();
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const record = parsed as { version?: unknown; ids?: unknown };
  if (record.version !== SCHEMA_VERSION || !Array.isArray(record.ids)) {
    return [];
  }
  return record.ids.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
}

/** Records a presented notice so the next document stays silent about it. */
export function recordPresentedNoticeId(id: string): void {
  const ids = new Set(readPresentedNoticeIds());
  ids.add(id);
  try {
    storage()?.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: SCHEMA_VERSION, ids: [...ids] }),
    );
  } catch {
    // A full or denied quota must never block presenting the notice itself.
  }
}

/** Forgets every presented notice. For tests only. */
export function clearPresentedNoticeIds(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do: an unreadable slot already reads as nothing presented.
  }
}
