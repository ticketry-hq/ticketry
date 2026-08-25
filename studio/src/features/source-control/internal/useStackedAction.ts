import { useState } from "react";
import {
  useCommitAndPushCheckout,
  useCommitCheckout,
  useCommitPushAndOpenPullRequest,
  useOpenPullRequest,
} from "../mutations";
import type {
  ActionStep,
  ActionStepName,
  CheckoutRef,
  CommitOutcome,
  CommitPushOutcome,
  PullRequestOutcome,
} from "../types";
import {
  actionFailureMessage,
  commitPushSummary,
  hookOutput,
  outcomeSummary,
  pullRequestSummary,
} from "./actionPresentation";
import { PLAN_STEPS, primaryPlan, type ActionPlan } from "./actionPlans";

export type { ActionPlan } from "./actionPlans";

/** Everything the footer needs to render one action, running or settled. */
export interface StackedAction {
  plan: ActionPlan;
  /** True while any of the four actions is in flight. */
  running: boolean;
  /** True while this specific plan is the one in flight. */
  isRunning(plan: ActionPlan): boolean;
  order: readonly ActionStepName[];
  steps: ReadonlyMap<ActionStepName, ActionStep>;
  /** The settled run's one-line result, written by whichever action ran. */
  summary: string | null;
  /** The curated sentence for an action that failed before it wrote anything. */
  failure: string | null;
  /** A refused commit's captured hook output — the one raw output ever shown. */
  hookOutput: string | null;
  /** The pull request to send the user to, once one exists. */
  pullRequestUrl: string | null;
  /**
   * True when the branch is published but GitHub refused the pull request.
   *
   * The one state where offering the last step on its own is the right next
   * move: everything before it succeeded, so re-running the whole stack would
   * ask three questions that are already answered.
   */
  canRetryPullRequest: boolean;
  run(plan: ActionPlan): void;
}

/** One plan's mutation, reduced to the four things the footer reads from it. */
interface Runner {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: CommitOutcome | CommitPushOutcome | PullRequestOutcome | undefined;
  mutate(): void;
  reset(): void;
}

/**
 * The footer's action state, kept out of the footer's markup.
 *
 * One rule holds the whole thing together: at most one action's result is ever
 * on screen. Starting any plan resets the other three, so a stale outcome can
 * never sit under a fresh run's steps, and the step list is always describing
 * the plan whose button was pressed.
 */
export function useStackedAction(checkout: CheckoutRef): StackedAction {
  const runners: Record<ActionPlan, Runner> = {
    commit: useCommitCheckout(checkout),
    commit_push: useCommitAndPushCheckout(checkout),
    commit_push_pr: useCommitPushAndOpenPullRequest(checkout),
    pull_request: useOpenPullRequest(checkout),
  };
  // Starts on this checkout kind's primary action, so the plan shown before
  // anything runs is the plan of the button that runs by default.
  const [plan, setPlan] = useState<ActionPlan>(primaryPlan(checkout.kind));

  const plans = Object.keys(runners) as ActionPlan[];
  const active = runners[plan];
  const settled = active.isError ? undefined : active.data;
  const pullRequest = asPullRequest(plan, settled);

  return {
    plan,
    running: plans.some((candidate) => runners[candidate].isPending),
    isRunning: (candidate) => runners[candidate].isPending,
    order: PLAN_STEPS[plan],
    steps: new Map((settled?.steps ?? []).map((step) => [step.name, step])),
    summary: summaryFor(checkout.kind, plan, settled),
    failure: active.isError ? actionFailureMessage(active.error) : null,
    hookOutput: active.isError ? hookOutput(active.error) : null,
    pullRequestUrl: pullRequest?.pull_request_url ?? null,
    canRetryPullRequest: pullRequest?.status === "pull_request_failed",
    run: (next) => {
      setPlan(next);
      for (const candidate of plans) {
        if (candidate !== next) runners[candidate].reset();
      }
      runners[next].mutate();
    },
  };
}

/**
 * The settled result read as a pull-request outcome, when the plan produced one.
 *
 * The plan is what decides, not the shape: only the two pull-request plans can
 * return one, and a commit-only result must never be mistaken for a pull
 * request that was never asked for.
 */
function asPullRequest(
  plan: ActionPlan,
  settled: Runner["data"],
): PullRequestOutcome | null {
  if (plan !== "commit_push_pr" && plan !== "pull_request") return null;
  return (settled as PullRequestOutcome | undefined) ?? null;
}

function summaryFor(
  kind: CheckoutRef["kind"],
  plan: ActionPlan,
  settled: Runner["data"],
): string | null {
  if (!settled) return null;
  if (plan === "commit") return outcomeSummary(kind, settled as CommitOutcome);
  if (plan === "commit_push") {
    return commitPushSummary(kind, settled as CommitPushOutcome);
  }
  return pullRequestSummary(kind, settled as PullRequestOutcome);
}
