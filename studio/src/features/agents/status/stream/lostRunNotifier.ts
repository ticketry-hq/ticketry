import { toast } from "../../../../state/clientStore";

const LOSS_BATCH_MS = 250;

export interface LostRunNotifier {
  record(agentRunId: string): void;
  cancel(): void;
}

function lossMessage(count: number): string {
  return count === 1
    ? "A terminal session closed. You can resume it from terminal history."
    : `${count} terminal sessions closed. You can resume them from terminal history.`;
}

/** Groups one reconciliation burst into one quiet, actionable notice. */
export function createLostRunNotifier(): LostRunNotifier {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const count = pending.size;
    pending.clear();
    if (count > 0) toast.info(lossMessage(count));
  };

  return {
    record(agentRunId) {
      pending.add(agentRunId);
      if (timer === null) timer = setTimeout(flush, LOSS_BATCH_MS);
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending.clear();
    },
  };
}
