import type {
  ShipRecord,
  ShipStepOutcome,
} from "@worktracker/typescript-sdk/models";
import { PullRequestStatus } from "./PullRequestStatus";

interface ShipHistoryProps {
  projectId: string;
  moduleId: string;
  checkoutLabel: string;
  records: readonly ShipRecord[];
}

const OUTCOMES = [
  ["Commit", "commit_outcome"],
  ["Push", "push_outcome"],
  ["Create PR", "create_pr_outcome"],
] as const;

export function ShipHistory({
  projectId,
  moduleId,
  checkoutLabel,
  records,
}: ShipHistoryProps) {
  if (records.length === 0) {
    return (
      <div
        role="status"
        aria-label={`No ship history for ${checkoutLabel}`}
        className="mt-2 text-text-muted"
      >
        No ship history.
      </div>
    );
  }

  return (
    <ol aria-label={`Ship history for ${checkoutLabel}`} className="mt-2 space-y-2">
      {records.map((record) => (
        <ShipRecordRow
          key={record.id}
          projectId={projectId}
          moduleId={moduleId}
          record={record}
        />
      ))}
    </ol>
  );
}

function ShipRecordRow({
  projectId,
  moduleId,
  record,
}: {
  projectId: string;
  moduleId: string;
  record: ShipRecord;
}) {
  const actionTime = formatActionTime(record.action_at);
  const commitShas = Array.isArray(record.commit_shas)
    ? record.commit_shas.filter((sha): sha is string => typeof sha === "string")
    : [];

  return (
    <li
      aria-label={`Ship record from ${actionTime}`}
      className="border-t border-pane-border/70 pt-2"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <time
          dateTime={record.action_at}
          aria-label={`Action time ${actionTime}`}
          className="text-text-secondary"
        >
          {actionTime}
        </time>
        <span
          aria-label={`Branch ${record.branch}`}
          className="max-w-full truncate font-mono text-text-primary"
          title={record.branch}
        >
          {record.branch}
        </span>
      </div>

      <div aria-label="Commit identities" className="mt-1 text-text-muted">
        Commits:{" "}
        {commitShas.length === 0 ? (
          <span>none created</span>
        ) : (
          commitShas.map((sha, index) => (
            <span key={`${sha}-${index}`}>
              {index > 0 ? ", " : null}
              <code aria-label={`Commit ${sha}`} title={sha}>
                {sha.slice(0, 7)}
              </code>
            </span>
          ))
        )}
      </div>

      <ul aria-label="Ship outcomes" className="mt-1 space-y-0.5">
        {OUTCOMES.map(([label, field]) => (
          <Outcome key={field} label={label} outcome={record[field]} />
        ))}
      </ul>

      <PullRequestStatus
        projectId={projectId}
        moduleId={moduleId}
        record={record}
      />
    </li>
  );
}

function Outcome({
  label,
  outcome,
}: {
  label: string;
  outcome: ShipStepOutcome;
}) {
  const status = outcome.status[0].toUpperCase() + outcome.status.slice(1);
  const accessible = `${label} outcome: ${status}${
    outcome.message ? `. ${outcome.message}` : ""
  }`;

  return (
    <li aria-label={accessible} className="text-text-secondary">
      <span>{label}: {status}</span>
      {outcome.message ? (
        <span className="text-text-muted">. {outcome.message}</span>
      ) : null}
    </li>
  );
}

function formatActionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown action time";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
