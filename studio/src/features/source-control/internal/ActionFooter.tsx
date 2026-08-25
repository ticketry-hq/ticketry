import { useState } from "react";
import { openPullRequestUrl } from "../mutations";
import type { CheckoutRef } from "../types";
import { ActionOutcome } from "./ActionOutcome";
import { ActionStepList } from "./ActionStepList";
import { PushConfirmation } from "./PushConfirmation";
import {
  menuPlans,
  planPresentation,
  primaryPlan,
  type ActionPlan,
} from "./actionPlans";
import { checkoutCopy } from "./checkoutCopy";
import { useStackedAction } from "./useStackedAction";

/**
 * The Changes tab's stacked-action footer (ADR 0012, ADR 0013, CODING-961 HLD).
 *
 * Three lengths of one action, and the difference is only how far it goes.
 * Which one leads is the checkout's decision, not this component's: a task
 * worktree leads with `Commit, push & create PR`, a module base checkout with
 * `Commit & push`, and each keeps the others in its action menu. None of them
 * offers per-file selection, because curation happens upstream by having an
 * agent fix the tree.
 *
 * Both push-bearing spellings go through the confirmation and committing does
 * not. That asymmetry is the point: a commit is local and reversible, and a
 * push is the moment work leaves the machine. The confirmation says which of
 * the two it is about, so the user is never asked to approve a push and given a
 * pull request, or the reverse.
 */
export function ActionFooter({
  checkout,
  hasChanges,
}: {
  checkout: CheckoutRef;
  hasChanges: boolean;
}) {
  const action = useStackedAction(checkout);
  // Which plan the confirmation is guarding, or null when it is closed. Held as
  // the plan rather than a boolean so the confirmation cannot be opened by one
  // button and confirmed into the other's action.
  const [confirming, setConfirming] = useState<ActionPlan | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const primary = primaryPlan(checkout.kind);

  const start = (plan: ActionPlan) => {
    setMenuOpen(false);
    if (!planPresentation(plan).confirms) {
      setConfirming(null);
      action.run(plan);
      return;
    }
    setConfirming((current) => (current === plan ? null : plan));
  };

  return (
    <footer
      data-testid="action-footer"
      data-primary-action={primary}
      className="shrink-0 border-t border-pane-border px-3 py-2"
    >
      <div className="flex items-center gap-2">
        <PlanButton
          plan={primary}
          action={action}
          confirming={confirming}
          onPress={start}
        />
        <button
          type="button"
          onClick={() => {
            setConfirming(null);
            setMenuOpen((open) => !open);
          }}
          disabled={action.running}
          aria-expanded={menuOpen}
          aria-label="Other actions"
          className="shrink-0 border border-pane-border px-2 py-1 text-xs text-text-secondary hover:bg-pane-title disabled:opacity-50"
        >
          ⋯
        </button>
        <p className="min-w-0 flex-1 text-xs text-text-muted">
          {checkoutCopy(checkout.kind).safety}
        </p>
      </div>

      {menuOpen && (
        <div
          data-testid="action-menu"
          role="group"
          aria-label="Other actions"
          className="mt-2 flex flex-col gap-2"
        >
          {menuPlans(checkout.kind).map((plan) => (
            <div key={plan} className="flex items-center gap-2">
              <PlanButton
                plan={plan}
                action={action}
                confirming={confirming}
                onPress={start}
                // Committing with nothing to commit is the one action with
                // nothing to do; the push-bearing plans still have a branch to
                // publish and say so through the confirmation.
                disabled={plan === "commit" && !hasChanges}
              />
              <span className="text-xs text-text-muted">
                {planPresentation(plan).hint}
              </span>
            </div>
          ))}
        </div>
      )}

      {confirming !== null && (
        <PushConfirmation
          checkout={checkout}
          opensPullRequest={confirming === "commit_push_pr"}
          onConfirm={() => {
            setConfirming(null);
            action.run(confirming);
          }}
          onCancel={() => setConfirming(null)}
        />
      )}

      <ActionStepList
        order={action.order}
        reported={action.steps}
        running={action.running}
      />

      <ActionOutcome
        action={action}
        onViewPullRequest={() => openPullRequestUrl(action.pullRequestUrl)}
      />
    </footer>
  );
}

/** One plan's button, wherever it happens to sit for this checkout kind. */
function PlanButton({
  plan,
  action,
  confirming,
  onPress,
  disabled = false,
}: {
  plan: ActionPlan;
  action: ReturnType<typeof useStackedAction>;
  confirming: ActionPlan | null;
  onPress: (plan: ActionPlan) => void;
  disabled?: boolean;
}) {
  const presentation = planPresentation(plan);
  return (
    <button
      type="button"
      onClick={() => onPress(plan)}
      disabled={action.running || disabled}
      aria-expanded={presentation.confirms ? confirming === plan : undefined}
      className="shrink-0 border border-pane-border px-2 py-1 text-xs text-text-primary hover:bg-pane-title disabled:opacity-50"
    >
      {action.isRunning(plan) ? presentation.running : presentation.label}
    </button>
  );
}
