import { useState, type MouseEvent } from "react";
import { retryAutomationAttempt } from "../status/retryAutomationAttempt";
import { selectTaskAutomationAttempts, useAgentStatusStore } from "../status";

interface Props {
  issueId: string;
  descendantIds?: string[];
  className?: string;
}

export function AutomationFailureChicklet({
  issueId,
  descendantIds = [],
  className,
}: Props) {
  const attempts = useAgentStatusStore((state) =>
    selectTaskAutomationAttempts(state, issueId, descendantIds),
  );
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  if (attempts.length === 0) return null;

  const failed = attempts.filter((attempt) => attempt.status === "failed");
  const pending = attempts.filter((attempt) => attempt.status === "pending");
  const retryPending = isRetrying || pending.length > 0;
  const title = failed
    .map((attempt) => attempt.error)
    .filter(Boolean)
    .join("; ");

  const retry = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (retryPending || failed.length === 0) return;
    setIsRetrying(true);
    setRetryError(null);
    try {
      await Promise.all(
        failed.map((attempt) => retryAutomationAttempt(attempt.attempt_id)),
      );
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "Retry failed");
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <span
      className={`inline-flex shrink-0 items-center border border-red-500/60 bg-red-500/10 text-[10px] font-bold leading-4 text-red-600 ${className ?? ""}`}
      data-testid="automation-failure-chicklet"
      title={title || "Automated launch failed"}
    >
      <span className="px-1" aria-hidden="true">
        {retryPending ? `⟳${attempts.length}` : `!${failed.length}`}
      </span>
      <button
        type="button"
        className="border-l border-red-500/40 px-1 hover:bg-red-500/15 disabled:cursor-wait"
        aria-label="Retry failed automated launch"
        disabled={retryPending || failed.length === 0}
        onClick={(event) => void retry(event)}
      >
        {retryPending ? "Retrying…" : retryError ? "Retry failed" : "Retry"}
      </button>
    </span>
  );
}
