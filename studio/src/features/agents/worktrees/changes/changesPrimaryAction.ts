import type { PullRequestStatusValue } from "./PullRequestStatus";

export type ChangesPrimaryActionKind = "stack" | "push" | "create-pull-request" | "none";

export interface ChangesPrimaryAction {
  kind: ChangesPrimaryActionKind;
  label: string;
  disabledReason: string | null;
}

export function changesPrimaryAction(input: {
  dirty: boolean;
  stackKind?: "task" | "module";
  unpushedCount: number;
  pullRequestCreationEligible: boolean;
  pullRequestUrl?: string | null;
  pullRequest?: PullRequestStatusValue | null;
}): ChangesPrimaryAction {
  const publishes = input.pullRequestCreationEligible && !input.pullRequestUrl;
  if (input.dirty) {
    return {
      kind: "stack",
      label: publishes && input.stackKind === "task" ? "Commit, push & create PR" : "Commit & push",
      disabledReason: null,
    };
  }
  if (input.unpushedCount > 0) return { kind: "push", label: "Push", disabledReason: null };
  if (publishes) return { kind: "create-pull-request", label: "Create PR", disabledReason: null };
  return {
    kind: "none",
    label: "Commit & push",
    disabledReason: input.pullRequest?.state === "merged" ? "This work is already merged." : "Nothing to commit or push.",
  };
}
