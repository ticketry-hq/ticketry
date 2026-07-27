import type { SessionMeta } from "../../agents/terminal/appNavigation";

function formatSequenceId(value: number | null): string | null {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : null;
}

/** Strip/chip label for a terminal session (shared by tabs and history chips). */
export function terminalLabel(meta: SessionMeta): string {
  const seq = formatSequenceId(meta.ticketSeq);
  if (seq) return `#${seq} · ${meta.agent}`;
  if (meta.isInstant) return "instant";
  if (meta.isPlanning) return "plan";
  return meta.agent;
}
