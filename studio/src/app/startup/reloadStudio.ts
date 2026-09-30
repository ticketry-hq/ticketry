/**
 * The one full Studio refresh used by every WebView recovery policy, and the
 * evidence trail that explains it.
 *
 * A refresh destroys the document, so anything logged in the same tick may
 * never reach the desktop file log. The cause is therefore written to
 * window-session storage first and logged again by the document that comes
 * back, so the file log always carries a "why" next to every reload.
 */

export interface StudioReloadCause {
  /** Which recovery policy asked for the refresh. */
  source: string;
  /** Everything that policy knows about why. Must be JSON-serialisable. */
  details: unknown;
}

export interface StudioReloadEvidence {
  at: string;
  href: string;
  cause: StudioReloadCause;
}

export const STUDIO_RELOAD_EVIDENCE_KEY = "ticketry.studio.reloadEvidence";

function storage(): Storage | null {
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function reloadStudio(
  cause: StudioReloadCause,
  refresh: () => void = () => window.location.reload(),
): void {
  const evidence: StudioReloadEvidence = {
    at: new Date().toISOString(),
    href: window.location.href,
    cause,
  };
  try {
    console.error("[studio-reload] reloading studio", evidence);
    storage()?.setItem(STUDIO_RELOAD_EVIDENCE_KEY, JSON.stringify(evidence));
  } catch {
    // Evidence must never stop the recovery it describes.
  }
  refresh();
}

/**
 * Logs and clears the previous document's reload evidence. Call once the
 * frontend log bridge is installed so the record lands in the file log.
 */
export function reportPendingStudioReload(): StudioReloadEvidence | null {
  let evidence: StudioReloadEvidence | null = null;
  try {
    const raw = storage()?.getItem(STUDIO_RELOAD_EVIDENCE_KEY);
    if (!raw) return null;
    storage()?.removeItem(STUDIO_RELOAD_EVIDENCE_KEY);
    evidence = JSON.parse(raw) as StudioReloadEvidence;
  } catch {
    return null;
  }
  console.warn("[studio-reload] previous document was reloaded", evidence);
  return evidence;
}
