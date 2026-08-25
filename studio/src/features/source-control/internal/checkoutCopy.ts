import type { CheckoutKind } from "../types";

/**
 * The few review sentences that differ between checkout kinds.
 *
 * The surface is one panel, so the wording is one table rather than branches
 * scattered through the component: a task worktree is reviewed against the
 * branch it will merge, and a module base checkout is reviewed on its own.
 */
const COPY: Record<
  CheckoutKind,
  {
    heading: string;
    clean: string;
    absentLead: string;
    /** What the surface calls this checkout inside a sentence. */
    noun: string;
    /** The footer's standing safety promise, before anything runs. */
    safety: string;
  }
> = {
  worktree: {
    heading: "Worktree changes",
    clean: "This worktree matches its last commit.",
    absentLead: "No worktree to review",
    noun: "worktree",
    safety:
      "Commits every change in this worktree. Repository hooks always run, " +
      "push never forces, and the pull request uses your own gh login.",
  },
  module: {
    heading: "Module checkout changes",
    clean: "This checkout matches its last commit.",
    absentLead: "Nothing to review",
    noun: "checkout",
    safety:
      "Commits every change in this module's checkout. Repository hooks " +
      "always run, push never forces, and a pull request needs a branch " +
      "other than the repository's default.",
  },
};

export function checkoutCopy(kind: CheckoutKind) {
  return COPY[kind];
}

/**
 * What a result sentence calls the checkout it is about.
 *
 * "The commit is safe in this worktree" is the wrong sentence for a module
 * base checkout, and the right one differs by one word — so the word is a
 * lookup rather than two copies of every outcome message.
 */
export function checkoutNoun(kind: CheckoutKind): string {
  return COPY[kind].noun;
}

export function absenceMessage(kind: CheckoutKind, reason: string): string {
  const fallback =
    kind === "module"
      ? "this module has no readable checkout"
      : "this task has no worktree";
  return `${COPY[kind].absentLead} — ${reason || fallback}.`;
}
