export interface WorktreeCheckoutStatus {
  kind: string;
  task_id?: string | null;
  available: boolean;
  dirty?: boolean | null;
  unpushed_count?: number | null;
  pull_request_state: string;
  reason?: string | null;
}

export interface WorktreeCheckoutRow {
  taskId: string | null;
  label: string;
  branch: string | null;
  summary: string | null;
}

export function withCheckoutStatus(
  row: Omit<WorktreeCheckoutRow, "summary">,
  status?: WorktreeCheckoutStatus | null,
): WorktreeCheckoutRow {
  if (!status) return { ...row, summary: null };
  if (!status.available) return { ...row, summary: status.reason ?? "unavailable" };
  if (status.pull_request_state !== "none") return { ...row, summary: status.pull_request_state.replace(/_/g, " ") };
  const local = [status.dirty ? "uncommitted" : null, (status.unpushed_count ?? 0) > 0 ? `${status.unpushed_count} unpushed` : null].filter(Boolean);
  return { ...row, summary: local.length ? local.join(" · ") : "clean" };
}
