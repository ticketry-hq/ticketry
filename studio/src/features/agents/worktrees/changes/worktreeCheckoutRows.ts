export interface WorktreeCheckoutStatus {
  kind: string;
  task_id?: string | null;
  available: boolean;
  dirty?: boolean | null;
  unpushed_count?: number | null;
  pull_request_state: string;
  reason?: string | null;
}

export type CheckoutTone = "danger" | "attention" | "success" | "active" | "muted";

export interface WorktreeCheckoutRow {
  taskId: string | null;
  label: string;
  branch: string | null;
  /** One short phrase naming the state a reader acts on, when it is known. */
  summary: string | null;
  tone: CheckoutTone;
}

const TONE_CLASS: Record<CheckoutTone, string> = {
  danger: "bg-lifecycle-danger",
  attention: "bg-lifecycle-attention",
  success: "bg-lifecycle-success",
  active: "bg-lifecycle-active",
  muted: "bg-text-muted",
};

export function checkoutToneClass(tone: CheckoutTone): string {
  return TONE_CLASS[tone];
}

const PULL_REQUEST_TONE: Record<string, { tone: CheckoutTone; summary: string }> = {
  ready: { tone: "success", summary: "PR ready" },
  merge_conflict: { tone: "danger", summary: "PR conflicts" },
  checks_failed: { tone: "danger", summary: "checks failed" },
  checks_pending: { tone: "active", summary: "checks running" },
  approval_required: { tone: "attention", summary: "approval required" },
  mergeability_pending: { tone: "active", summary: "mergeability pending" },
  wrong_base: { tone: "danger", summary: "wrong base" },
  merged: { tone: "success", summary: "merged" },
  closed_unmerged: { tone: "muted", summary: "PR closed" },
};

/**
 * Add live state to a checkout row when the module view has already reported it.
 *
 * The switcher replaced a full column, so each row can afford to say whether a
 * checkout is dirty, ahead, or blocked on its pull request. Pull-request trouble
 * outranks local work because it blocks shipping, and local work outranks a
 * clean checkout because it still needs an action. A row with no status yet
 * stays listed and unadorned rather than waiting for one.
 */
export function withCheckoutStatus(
  row: Omit<WorktreeCheckoutRow, "summary" | "tone">,
  status?: WorktreeCheckoutStatus | null,
): WorktreeCheckoutRow {
  if (!status) return { ...row, summary: null, tone: "muted" };
  if (!status.available) {
    return { ...row, summary: status.reason ?? "unavailable", tone: "danger" };
  }
  const pullRequest = PULL_REQUEST_TONE[status.pull_request_state];
  if (pullRequest) return { ...row, ...pullRequest };
  const local = localSummary(status);
  if (local) return { ...row, summary: local, tone: "attention" };
  return { ...row, summary: "clean", tone: "muted" };
}

function localSummary(status: WorktreeCheckoutStatus): string | null {
  const unpushed = status.unpushed_count ?? 0;
  const parts: string[] = [];
  if (status.dirty) parts.push("uncommitted");
  if (unpushed > 0) parts.push(`${unpushed} unpushed`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
