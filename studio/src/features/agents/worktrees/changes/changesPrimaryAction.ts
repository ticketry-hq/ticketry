import type { PullRequestStatusValue } from "./PullRequestStatus";

/**
 * The one action the toolbar offers for a checkout.
 *
 * Option C gives the toolbar a single primary button whose label is derived
 * from branch state rather than a row of equally-weighted buttons. Every other
 * command stays available in the branch inspector, so deriving the default
 * here never removes a capability — it only names the expected next step.
 */
export type ChangesPrimaryActionKind =
  | "stack"
  | "push"
  | "create-pull-request"
  | "none";

export interface ChangesPrimaryAction {
  kind: ChangesPrimaryActionKind;
  label: string;
  /** Why the button is unavailable, for a disabled tooltip. Null when enabled. */
  disabledReason: string | null;
}

export interface ChangesPrimaryActionInput {
  dirty: boolean;
  /** Only a task checkout opens a pull request as part of its stacked action. */
  stackKind?: "task" | "module";
  unpushedCount: number;
  pullRequestCreationEligible: boolean;
  pullRequestUrl?: string | null;
  pullRequest?: PullRequestStatusValue | null;
}

export function changesPrimaryAction({
  dirty,
  stackKind,
  unpushedCount,
  pullRequestCreationEligible,
  pullRequestUrl,
  pullRequest,
}: ChangesPrimaryActionInput): ChangesPrimaryAction {
  const publishes = pullRequestCreationEligible && !pullRequestUrl;
  if (dirty) {
    return {
      kind: "stack",
      label: publishes && stackKind === "task"
        ? "Commit, push & create PR"
        : "Commit & push",
      disabledReason: null,
    };
  }
  if (unpushedCount > 0) {
    return { kind: "push", label: "Push", disabledReason: null };
  }
  if (publishes) {
    return { kind: "create-pull-request", label: "Create PR", disabledReason: null };
  }
  return {
    kind: "none",
    label: "Commit & push",
    disabledReason: pullRequest?.integrated
      ? "This work is already merged."
      : "Nothing to commit or push.",
  };
}
