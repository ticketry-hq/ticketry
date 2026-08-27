/**
 * The authoritative reset protocol.
 *
 * A reset is the only moment the client is told its own history is unusable.
 * The order below is what makes recovery safe rather than merely quiet:
 *
 * 1. Buffer every newer project event that arrives while the reset runs. They
 *    are facts, and they must not be dropped just because the baseline under
 *    them is being replaced.
 * 2. Refetch every canonical holding.
 * 3. Only then install the server's high-water cursor as the new baseline.
 * 4. Apply the buffered facts strictly above that baseline, in cursor order.
 *
 * Installing the baseline first would accept whatever stale holdings the
 * client already had as if they were canonical. Applying the buffer first
 * would paint facts onto a holding that is about to be replaced. Discarding
 * the buffer would lose facts that will never be replayed, because the
 * installed cursor is already past them.
 *
 * A refresh that fails installs nothing and keeps the buffer: the caller closes
 * and retries the subscription, and the next reset drains the same facts on top
 * of holdings that actually loaded.
 */
import type { RunStatusEventFrame } from "../types";

export interface AuthoritativeResetOptions {
  /** Refetch every canonical holding. Rejecting means "do not baseline". */
  refresh(): Promise<void>;
  /** Install the reset baseline. Called only after `refresh` resolves. */
  install(cursor: number): void;
  /** Apply one buffered fact above the installed baseline. */
  applyEvent(frame: RunStatusEventFrame): void;
  /** False once this reset's subscription is superseded, stopped, or switched. */
  owns(): boolean;
  /** Close and retry the subscription without baselining. */
  onFailed(): void;
}

export interface AuthoritativeReset {
  /** Enter reset for the supplied high-water cursor. */
  begin(cursor: number): void;
  /** True when the frame was buffered rather than applied now. */
  capture(frame: RunStatusEventFrame): boolean;
  /** True while a refresh is in flight. */
  isRefreshing(): boolean;
  /** Drop the buffer; used when the feed stops or switches project. */
  cancel(): void;
}

export function createAuthoritativeReset(
  options: AuthoritativeResetOptions,
): AuthoritativeReset {
  // Keyed by cursor, so a duplicate or redelivered fact is captured once and a
  // backwards one cannot reorder the drain.
  const buffered = new Map<number, RunStatusEventFrame>();
  let refreshing = false;
  let baseline: number | null = null;
  /** Bumped by `cancel`, so a refresh already in flight can write nothing. */
  let epoch = 0;

  /** Apply what was buffered, in cursor order, above the installed baseline. */
  const drain = (installed: number) => {
    const ordered = [...buffered.entries()].sort(
      ([left], [right]) => left - right,
    );
    buffered.clear();
    for (const [cursor, frame] of ordered) {
      // A fact the refetched holdings already reflect is dropped rather than
      // reapplied: the baseline is authoritative for everything at or below it.
      if (cursor <= installed) continue;
      options.applyEvent(frame);
      options.install(cursor);
    }
  };

  return {
    begin(cursor) {
      if (!Number.isSafeInteger(cursor) || cursor < 0) return;
      baseline = baseline === null ? cursor : Math.max(baseline, cursor);
      if (refreshing) return; // A refresh is already covering this reset.
      refreshing = true;
      const era = epoch;
      void options
        .refresh()
        .then(() => {
          if (era !== epoch) return;
          refreshing = false;
          // The newest reset cursor seen while the refresh ran is the baseline:
          // a later one describes history the server has refused more recently.
          const installed = baseline ?? cursor;
          baseline = null;
          // A project switch or teardown during the reset must write nothing,
          // however late the refresh resolves.
          if (!options.owns()) {
            buffered.clear();
            return;
          }
          options.install(installed);
          drain(installed);
        })
        .catch(() => {
          if (era !== epoch) return;
          refreshing = false;
          baseline = null;
          // The buffer survives: those facts are above the cursor the server
          // will hand back next time, so nothing else would redeliver them.
          if (options.owns()) options.onFailed();
        });
    },

    capture(frame) {
      if (!refreshing) return false;
      if (!Number.isSafeInteger(frame.cursor)) return true;
      buffered.set(frame.cursor, frame);
      return true;
    },

    isRefreshing: () => refreshing,

    cancel() {
      buffered.clear();
      refreshing = false;
      baseline = null;
      epoch += 1;
    },
  };
}
