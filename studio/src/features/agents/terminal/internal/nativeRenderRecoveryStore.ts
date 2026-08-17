/**
 * Window-session persistence for the native render recovery campaign.
 *
 * The campaign has to outlive the document it started in: each refresh
 * destroys the WebView, so the only way the delay can actually grow is to
 * carry the next attempt number across the reload. Session-scoped storage is
 * exactly the wanted lifetime — it survives a refresh and dies with the
 * desktop window, so reopening the window begins a fresh campaign.
 *
 * Only two numbers are ever stored: the schema version and the next attempt.
 * Anything else in that slot is somebody else's data or an obsolete shape, and
 * is treated as no campaign at all.
 */

const STORAGE_KEY = "ticketry.terminal.nativeRenderRecovery";

/** Bumped whenever the persisted shape changes; older records reset safely. */
const CAMPAIGN_SCHEMA_VERSION = 1;

/** The attempt a brand-new campaign starts from. */
export const FIRST_NATIVE_RENDER_RECOVERY_ATTEMPT = 0;

function storage(): Storage | null {
  try {
    return window.sessionStorage ?? null;
  } catch {
    // Storage can be denied outright (private modes, hardened WebViews).
    // Recovery still works; it just cannot grow its delay across refreshes.
    return null;
  }
}

/**
 * The attempt the next refresh should use.
 *
 * Missing, unparseable, wrongly shaped, unknown-version, negative and
 * non-integral records all mean the same thing to the policy: there is no
 * trustworthy campaign, so start one at the first attempt.
 */
export function readNativeRenderRecoveryAttempt(): number {
  const raw = (() => {
    try {
      return storage()?.getItem(STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  })();
  if (raw === null) return FIRST_NATIVE_RENDER_RECOVERY_ATTEMPT;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return FIRST_NATIVE_RENDER_RECOVERY_ATTEMPT;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return FIRST_NATIVE_RENDER_RECOVERY_ATTEMPT;
  }
  const record = parsed as { version?: unknown; nextAttempt?: unknown };
  if (record.version !== CAMPAIGN_SCHEMA_VERSION) {
    return FIRST_NATIVE_RENDER_RECOVERY_ATTEMPT;
  }
  const attempt = record.nextAttempt;
  if (typeof attempt !== "number" || !Number.isInteger(attempt) || attempt < 0) {
    return FIRST_NATIVE_RENDER_RECOVERY_ATTEMPT;
  }
  return attempt;
}

/** Records the attempt the next document should refresh with. */
export function writeNativeRenderRecoveryAttempt(attempt: number): void {
  try {
    storage()?.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: CAMPAIGN_SCHEMA_VERSION,
        nextAttempt: attempt,
      }),
    );
  } catch {
    // A full or denied quota must never break the refresh that follows it.
  }
}

/** Ends the campaign so the next unrelated incident starts over. Idempotent. */
export function clearNativeRenderRecoveryAttempt(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do: an unreadable slot already behaves as no campaign.
  }
}
