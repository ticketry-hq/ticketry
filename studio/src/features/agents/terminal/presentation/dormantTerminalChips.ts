// Dormant terminal chips, presented by the same rules as the active tabs (#695).
//
// The row under the tab strip shows the runs a workspace is not currently
// looking at: conversations that can be resumed, and terminated ones kept as
// history. They are the *same runs* the strip labels, so they read the same
// way — the phase the conversation began in, the provider carried by colour,
// and the launch facts on hover — with no ticket identifier and no substitution
// from the Story's current state. Everything here is reconstructed from durable
// records, so a reload produces the identical chip.

import type { RunRecord } from "../../status";
import type { ResumableTerminalSession } from "../../types";
import { isLiveTerminalState } from "./terminalLiveness";
import {
  presentTerminalRuns,
  type TerminalRunFacts,
  type TerminalRunPresentation,
} from "./terminalRunPresentation";

export interface DormantTerminalChip extends TerminalRunPresentation {
  /** Provider slug, for the chip's colour token. */
  agent: string | null;
  /** Whether the underlying run is still going — colour depends on it. */
  live: boolean;
}

function scopeFlags(scope: string | null | undefined) {
  return { isPlanning: scope === "plan", isInstant: scope === "instant" };
}

function resumableFacts(
  session: ResumableTerminalSession,
  run: RunRecord | undefined,
): TerminalRunFacts {
  return {
    key: session.agent_run_id,
    agent: session.agent,
    // The listing carries its own launch snapshot, which outlives the status
    // snapshot's recency window; the pushed run record is an equally durable
    // second source for a run still inside it.
    launchState: session.launch_state ?? run?.launch_state ?? null,
    launchModel: session.launch_model ?? run?.launch_model ?? null,
    ...scopeFlags(session.scope ?? run?.scope),
    live: isLiveTerminalState(run?.state),
    // The row renders resumable and terminated chips as two differently
    // prefixed groups, so a name only has to be unique within its own (#709).
    nameScope: "resumable",
  };
}

function historyFacts(run: RunRecord): TerminalRunFacts {
  return {
    key: run.agent_run_id,
    agent: run.agent ?? null,
    launchState: run.launch_state ?? null,
    launchModel: run.launch_model ?? null,
    ...scopeFlags(run.scope),
    live: isLiveTerminalState(run.state),
    nameScope: "history",
  };
}

function toChip(
  facts: TerminalRunFacts,
  presentation: TerminalRunPresentation,
): DormantTerminalChip {
  return { ...presentation, agent: facts.agent, live: facts.live };
}

/**
 * Present a workspace's dormant chips, resumable ones first.
 *
 * Both kinds go through one `presentTerminalRuns` call because duplicate
 * ordinals are a property of the set: a resumable run and a history entry that
 * would collide have to be numbered against each other, not each within its own
 * row segment. Ended runs never collide, so in practice a dormant chip carries
 * an ordinal only in the case the rule already covers — one that is still live.
 */
export function presentDormantTerminalChips({
  resumableSessions,
  history,
  runs,
}: {
  resumableSessions: readonly ResumableTerminalSession[];
  history: readonly RunRecord[];
  runs: Readonly<Record<string, RunRecord>>;
}): { resumable: DormantTerminalChip[]; history: DormantTerminalChip[] } {
  const resumableRunFacts = resumableSessions.map((session) =>
    resumableFacts(session, runs[session.agent_run_id]),
  );
  const historyRunFacts = history.map(historyFacts);
  const presentations = presentTerminalRuns([
    ...resumableRunFacts,
    ...historyRunFacts,
  ]);
  return {
    resumable: resumableRunFacts.map((facts, index) =>
      toChip(facts, presentations[index]),
    ),
    history: historyRunFacts.map((facts, index) =>
      toChip(facts, presentations[resumableRunFacts.length + index]),
    ),
  };
}
