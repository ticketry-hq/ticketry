/**
 * How an automated transition reached its agent.
 *
 * A handoff edge types the destination prompt into the Work Item's live
 * session and mints no run; an ordinary automated launch spawns a fresh one.
 * Both settle the same Automation Attempt, so the attempt's `delivery_mode` is
 * the only durable evidence of which of the two happened — nothing about the
 * runs on screen distinguishes them.
 *
 * Deliberately unfiltered by attempt status: a continued handoff succeeds the
 * moment typed delivery lands, so filtering succeeded attempts out (as the
 * failure chicklet's selector does) would hide exactly the case this exists to
 * show.
 */
import type { AgentStatusData, AutomationAttemptRecord } from "./types";

export type AutomationDeliveryMode =
  NonNullable<AutomationAttemptRecord["delivery_mode"]>;

export interface AutomationDelivery {
  readonly mode: AutomationDeliveryMode;
  readonly attemptId: string;
  readonly at: string;
}

export interface AutomationDeliveryPresentation {
  readonly label: string;
  readonly glyph: string;
  readonly description: string;
}

export const AUTOMATION_DELIVERY_PRESENTATION: Record<
  AutomationDeliveryMode,
  AutomationDeliveryPresentation
> = {
  continued: {
    label: "Continued",
    glyph: "⇥",
    description: "This transition continued the Story's existing agent session.",
  },
  started_fresh: {
    label: "Fresh",
    glyph: "✦",
    description: "This transition started a fresh agent session.",
  },
};

/**
 * Attempt timestamps arrive in more than one ISO spelling (`+00:00` from the
 * durable outbox, `Z` from the projection), so they are ordered by instant
 * rather than lexically.
 */
function deliveredAt(attempt: AutomationAttemptRecord): number {
  const parsed = Date.parse(attempt.updated_at);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * The newest delivered automated transition across one Work Item and the
 * descendants rolled up beside it, or `null` when nothing on this subtree has
 * been delivered yet. An attempt whose delivery mode is still unrecorded has
 * not reached an agent, so it is not a delivery.
 */
export function selectTaskAutomationDelivery(
  state: AgentStatusData,
  taskId: string,
  descendantTaskIds: readonly string[] = [],
): AutomationDelivery | null {
  const rootIds = new Set(
    [taskId, ...descendantTaskIds].flatMap(
      (id) => state.automationByTask[id] ?? [],
    ),
  );
  let newest: AutomationAttemptRecord | null = null;
  for (const rootId of rootIds) {
    const attempt = state.automationAttempts[rootId];
    // A build that predates the delivery column publishes no mode at all, so
    // absent and null are both "not delivered" rather than a third state.
    if (!attempt?.delivery_mode) continue;
    if (newest === null || deliveredAt(attempt) > deliveredAt(newest)) {
      newest = attempt;
    }
  }
  return newest === null ? null : {
    mode: newest.delivery_mode as AutomationDeliveryMode,
    attemptId: newest.attempt_id,
    at: newest.updated_at,
  };
}
