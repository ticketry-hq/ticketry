import { WorkTrackerApiError } from "@worktracker/typescript-sdk/errors";
import type { ShipRecord } from "@worktracker/typescript-sdk/models";
import { SafeExternalLink } from "../../../shared/ui/SafeExternalLink";
import { useRefreshShipRecordPullRequestState } from "../mutations";

interface PullRequestStatusProps {
  projectId: string;
  moduleId: string;
  record: ShipRecord;
}

export function PullRequestStatus({
  projectId,
  moduleId,
  record,
}: PullRequestStatusProps) {
  const refresh = useRefreshShipRecordPullRequestState({
    projectId,
    moduleId,
    recordId: record.id,
  });

  if (!record.pr_url) {
    return (
      <div aria-label="No pull request" className="mt-1 text-text-muted">
        No pull request
      </div>
    );
  }

  const number = record.pr_number === null ? "" : ` #${record.pr_number}`;
  const state = record.pr_state
    ? record.pr_state[0].toUpperCase() + record.pr_state.slice(1)
    : "Unknown";
  const refreshLabel = `Refresh pull request${number} state`;

  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-center gap-2">
        <SafeExternalLink
          href={record.pr_url}
          aria-label={`Open pull request${number}`}
          className="text-focus-accent hover:underline"
        >
          PR{number}
        </SafeExternalLink>
        <span
          aria-label={`Pull request state ${state}`}
          className="text-text-secondary"
        >
          State: {state}
        </span>
        <button
          type="button"
          aria-label={refreshLabel}
          aria-busy={refresh.isPending}
          disabled={refresh.isPending}
          onClick={refresh.refresh}
          className="border border-pane-border px-1.5 py-0.5 text-text-secondary hover:text-text-primary disabled:cursor-wait disabled:opacity-60"
        >
          {refresh.isPending ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      {refresh.isError ? (
        <div
          role="alert"
          aria-label={`Pull request${number} refresh error`}
          className="mt-1 text-lifecycle-danger"
        >
          {refreshErrorMessage(refresh.error)}
        </div>
      ) : null}
    </div>
  );
}

function refreshErrorMessage(error: unknown): string {
  if (error instanceof WorkTrackerApiError) {
    const body = error.body;
    if (body && typeof body === "object") {
      const detail = (body as { detail?: unknown }).detail;
      if (typeof detail === "string" && detail) return detail;
    }
  }
  return "Could not refresh this pull request. Try again.";
}
