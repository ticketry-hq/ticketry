/**
 * What a module's panel shell tabs are, and how the set changes (#668).
 *
 * The rules here are pure so the parts that decide *which tab is visible* can
 * be read and tested without a store, a network call or a terminal: a module
 * owns an ordered set of shells, exactly one of them is active, and every
 * operation on the set leaves a determinate active tab behind. Ordering is the
 * backend's creation order, so a new shell appends to the strip instead of
 * displacing the ones already there.
 */

/**
 * The most shells one module may own.
 *
 * A cap exists because each tab is a durable session that outlives the window:
 * without one, a module accumulates forgotten processes. Four is enough for the
 * dev-server-plus-a-few-commands case the panel is for.
 */
export const MAX_MODULE_SHELLS = 4;

/** Why a module's strip is empty, when the reason is worth showing. */
export type ModuleShellProblem =
  /** No usable module folder; the remedy is the folder affordance. */
  | { kind: "needs-folder"; reason: string }
  /** Anything else that stopped a launch; the remedy is to retry. */
  | { kind: "failed"; reason: string };

/**
 * A shell that ended badly and is kept on the strip for inspection (#670).
 *
 * `exitCode` is the hosted shell's own result, or null when the ending
 * recorded none — a durable session that vanished ends a shell just as surely
 * as a failing command, and inventing a code for it would be a lie.
 */
export interface DeadShell {
  exitCode: number | null;
}

/** One module's shells, in strip order, with the visible one named. */
export interface ModuleShellSet {
  /** Run ids in strip order, oldest first. At most {@link MAX_MODULE_SHELLS}. */
  runIds: readonly string[];
  /** The one shell presented while the panel is open. */
  activeRunId: string | null;
  /** A rediscovery or a launch is in flight for this module. */
  busy: boolean;
  problem: ModuleShellProblem | null;
  /**
   * The shells in {@link runIds} that have ended without a clean exit, by run
   * id. They keep their slot on the strip so their failure can be read; a
   * clean exit is removed from `runIds` instead and never appears here.
   */
  dead: Readonly<Record<string, DeadShell>>;
  /**
   * Whether surviving shell runs have been rediscovered for this module.
   *
   * Until they have, an empty strip means "not looked yet", not "no shells" —
   * which is the difference between restoring a running dev server and
   * quietly starting a second one beside it.
   */
  discovered: boolean;
}

export const EMPTY_SHELL_SET: ModuleShellSet = {
  runIds: [],
  activeRunId: null,
  busy: false,
  problem: null,
  dead: {},
  discovered: false,
};

/** Whether this shell has ended without a clean exit and is being kept. */
export function deadShell(
  set: ModuleShellSet,
  runId: string,
): DeadShell | null {
  return set.dead[runId] ?? null;
}

/** The same map without one run, or the same reference when it held none. */
function withoutDead(
  dead: Readonly<Record<string, DeadShell>>,
  runId: string,
): Readonly<Record<string, DeadShell>> {
  if (!(runId in dead)) return dead;
  const next = { ...dead };
  delete next[runId];
  return next;
}

export function atCapacity(set: ModuleShellSet): boolean {
  return set.runIds.length >= MAX_MODULE_SHELLS;
}

/**
 * Folds the shells the backend still has for this module into the set.
 *
 * The remembered active tab wins whenever it survived, which is what makes a
 * module switch return to the shell that was last in front rather than to
 * whichever one is first. `persisted` is the same answer for a restart, where
 * this session remembers nothing: it is only consulted when the set itself
 * holds no surviving active tab, so a live choice is never overruled by an
 * older stored one.
 */
export function adoptDiscovered(
  set: ModuleShellSet,
  runIds: readonly string[],
  persisted: string | null = null,
): ModuleShellSet {
  const remembered = [set.activeRunId, persisted].find(
    (runId): runId is string => !!runId && runIds.includes(runId),
  );
  return {
    ...set,
    runIds: [...runIds],
    activeRunId: remembered ?? runIds[0] ?? null,
    problem: null,
    // Only shells still on the strip can be dead ones: the backend lists live
    // sessions, so anything it no longer has is gone from both.
    dead: Object.fromEntries(
      Object.entries(set.dead).filter(([runId]) => runIds.includes(runId)),
    ),
    discovered: true,
  };
}

/** Appends a freshly launched shell and shows it. */
export function withNewShell(
  set: ModuleShellSet,
  runId: string,
): ModuleShellSet {
  if (set.runIds.includes(runId)) return { ...set, activeRunId: runId };
  return {
    ...set,
    runIds: [...set.runIds, runId],
    activeRunId: runId,
    problem: null,
  };
}

/**
 * Removes a closed shell and names the tab that takes its place.
 *
 * Closing the active tab selects the one that slides into its position, or the
 * new last tab when the closed one was last. Closing any other tab leaves the
 * visible shell alone: a person closing a background tab did not ask to be
 * moved.
 */
export function withoutShell(
  set: ModuleShellSet,
  runId: string,
): ModuleShellSet {
  const index = set.runIds.indexOf(runId);
  if (index < 0) return set;
  const runIds = set.runIds.filter((id) => id !== runId);
  const dead = withoutDead(set.dead, runId);
  if (set.activeRunId !== runId) return { ...set, runIds, dead };
  return {
    ...set,
    runIds,
    dead,
    activeRunId: runIds[Math.min(index, runIds.length - 1)] ?? null,
  };
}

/**
 * Records that one shell's session ended, and decides whether its tab survives.
 *
 * A clean exit is the person closing their own shell: the tab goes, exactly as
 * if they had closed it themselves, because there is nothing left to read. Any
 * other ending keeps the tab in place with the code it ended on — a failed
 * shell is usually the only record of what went wrong, and disposing of it
 * would take that away at the moment it matters most.
 */
export function withExitedShell(
  set: ModuleShellSet,
  runId: string,
  exitCode: number | null,
): ModuleShellSet {
  if (!set.runIds.includes(runId)) return set;
  if (exitCode === 0) return withoutShell(set, runId);
  const recorded = set.dead[runId];
  if (recorded && recorded.exitCode === exitCode) return set;
  return { ...set, dead: { ...set.dead, [runId]: { exitCode } } };
}

/**
 * Puts a freshly launched shell in a dead one's slot.
 *
 * The replacement takes the position and, if the dead shell was showing, the
 * front — so a restart reads as the same tab coming back to life. The dead run
 * itself is only dropped from the strip: it stays ended for good, because a
 * durable session that exited cannot be revived and pretending otherwise would
 * point a viewer at a session that is not there.
 */
export function withRestartedShell(
  set: ModuleShellSet,
  deadRunId: string,
  runId: string,
): ModuleShellSet {
  const index = set.runIds.indexOf(deadRunId);
  if (index < 0) return withNewShell(set, runId);
  return {
    ...set,
    runIds: set.runIds.map((id) => (id === deadRunId ? runId : id)),
    activeRunId: set.activeRunId === deadRunId ? runId : set.activeRunId,
    dead: withoutDead(set.dead, deadRunId),
    problem: null,
  };
}
