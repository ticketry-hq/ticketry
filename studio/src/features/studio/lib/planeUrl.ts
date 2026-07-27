// Deep-link helpers for WorkTracker Studio.

/**
 * TS port of the seq-id formatting used in `tui/services.py` / TUI presenter.
 * Plane sequence_ids may be negative (e.g. -281); the TUI preserves the sign
 * verbatim. Returns the empty string for null/undefined.
 */
export function formatSequenceId(
  seq: number | string | null | undefined,
): string {
  if (seq === null || seq === undefined) return "";
  return String(seq);
}

/**
 * Build the "back" deep-link into WorkTracker Studio (#620 / S7): the issue's
 * stable `/issues/<KEY-N>` route, where KEY-N is `{slug}-{sequence_id}`. Gated
 * on VITE_STUDIO_URL — unset (or a missing slug/seq) yields null, so the link
 * simply doesn't render, mirroring how Studio's own seam no-ops on an unset
 * base. No new data is needed: the studio app already holds the project slug
 * (identifier) and the task's sequence id.
 */
export function studioUrl(
  slug: string | null | undefined,
  seq: number | string | null | undefined,
): string | null {
  const base = import.meta.env.VITE_STUDIO_URL || "";
  const seqStr = formatSequenceId(seq);
  if (!base || !slug || !seqStr) return null;
  return `${base.replace(/\/+$/, "")}/issues/${slug}-${seqStr}`;
}
