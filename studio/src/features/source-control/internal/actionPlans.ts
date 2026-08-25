import type { ActionStepName, CheckoutKind } from "../types";

/**
 * Which length of the stack an action runs, and how each one presents itself.
 *
 * The write surface is one action executed commit → push → pull request, and
 * these are the four points a user can ask it to stop at. `pull_request` is the
 * odd one out: it is not a longer stack but the last step on its own, offered
 * only as the retry after a provider failure.
 */
export type ActionPlan =
  | "commit"
  | "commit_push"
  | "commit_push_pr"
  | "pull_request";

const COMMIT_STEPS: ActionStepName[] = ["stage", "generate_message", "commit"];
const COMMIT_PUSH_STEPS: ActionStepName[] = [...COMMIT_STEPS, "push"];
const FULL_STACK_STEPS: ActionStepName[] = [...COMMIT_PUSH_STEPS, "pull_request"];

/** The steps each plan reports, which is also the plan shown before it runs. */
export const PLAN_STEPS: Record<ActionPlan, ActionStepName[]> = {
  commit: COMMIT_STEPS,
  commit_push: COMMIT_PUSH_STEPS,
  commit_push_pr: FULL_STACK_STEPS,
  // The pull-request-only action reports every earlier step as an explicit
  // skip, so it renders from the same list as the full stack.
  pull_request: FULL_STACK_STEPS,
};

interface PlanPresentation {
  /** The button's label before it runs. */
  label: string;
  /** The same button while this plan is in flight. */
  running: string;
  /** What the plan does, shown beside it in the action menu. */
  hint: string;
  /** Whether the plan goes through the push confirmation first. */
  confirms: boolean;
}

const PRESENTATION: Record<ActionPlan, PlanPresentation> = {
  commit_push_pr: {
    label: "Commit, push & create PR",
    running: "Committing, pushing & creating PR…",
    hint: "Publishes the branch and opens a pull request for it.",
    confirms: true,
  },
  commit_push: {
    label: "Commit & push",
    running: "Committing & pushing…",
    hint: "Publishes the branch without opening a pull request.",
    confirms: true,
  },
  commit: {
    label: "Commit all changes",
    running: "Committing…",
    hint: "Commits without sending anything to the remote.",
    confirms: false,
  },
  pull_request: {
    label: "Create pull request",
    running: "Creating pull request…",
    hint: "Opens the pull request for a branch that is already published.",
    confirms: false,
  },
};

export function planPresentation(plan: ActionPlan): PlanPresentation {
  return PRESENTATION[plan];
}

/**
 * Which plan each checkout kind leads with, and which it keeps in the menu.
 *
 * The available actions are the same for both kinds; only the *default* one
 * differs, and the reason is where each checkout normally sits. A task worktree
 * is on a branch cut for review, so the pull request is the point of the work.
 * A module base checkout is normally on the default branch, where a pull
 * request is refused by its own precondition — leading with an action that
 * always fails there would be a worse default than leading with the sync flow
 * (ADR 0013). The pull request stays one press away for the case that makes it
 * meaningful: a base checkout parked on a feature branch.
 */
const PLANS: Record<CheckoutKind, { primary: ActionPlan; menu: ActionPlan[] }> = {
  worktree: {
    primary: "commit_push_pr",
    menu: ["commit_push", "commit"],
  },
  module: {
    primary: "commit_push",
    menu: ["commit_push_pr", "commit"],
  },
};

export function primaryPlan(kind: CheckoutKind): ActionPlan {
  return PLANS[kind].primary;
}

export function menuPlans(kind: CheckoutKind): readonly ActionPlan[] {
  return PLANS[kind].menu;
}
