// The one liveness question terminal presentation asks (#695).
//
// Provider colour means "this conversation is still going", so exactly one rule
// must decide when it stops. Active tabs read a presentation lifecycle and
// dormant chips read a run record's state; both land here so a tab and the chip
// for the same run cannot disagree about whether it ended.
//
// This is deliberately not the status module's `isLiveAgentRunState`: that
// predicate answers a different question (an errored run is still attention-
// worthy there), while for colour an errored run has ended.

const ENDED_STATES: ReadonlySet<string> = new Set(["exited", "lost", "error"]);

export function isLiveTerminalState(
  state: string | null | undefined,
): boolean {
  return !!state && !ENDED_STATES.has(state);
}
