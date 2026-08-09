import type { SessionMeta } from "../../../../../features/agents/terminal/appNavigation";
import { formatWorkItemDisplayIdentifier } from "../../../../../features/work-items";

/**
 * First usable work-item sequence among the candidates. Anything that is not a
 * finite number (null, undefined, NaN) is not a sequence, so it can never reach
 * the formatter and produce a `T-null`/`T-undefined` label.
 */
function firstDisplayableSequence(
  ...candidates: readonly (number | null | undefined)[]
): number | null {
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Strip/chip label for a terminal session (shared by tabs and history chips).
 *
 * Task-bound sessions read as `T-<sequence> · <agent>`, the same compact
 * identifier the Stories pane shows. The workspace's own sequence wins so a
 * restored session — which carries no sequence of its own — still labels with
 * the ticket it was reattached under. Display only: terminal identity,
 * persistence, and run ownership keep their canonical/opaque identifiers.
 */
export function terminalLabel(
  meta: SessionMeta,
  ticketSeq?: number | null,
): string {
  const identifier = formatWorkItemDisplayIdentifier(
    firstDisplayableSequence(ticketSeq, meta.ticketSeq),
  );
  if (identifier) return `${identifier} · ${meta.agent}`;
  if (meta.isInstant) return "instant";
  if (meta.isPlanning) return "plan";
  return meta.agent;
}
