import { useQuery } from "@apollo/client/react";
import { type FormEvent, useRef, useState } from "react";

import { studioApolloClient } from "../../../../shared/apollo/client";
import { ModuleVersionControlDocument } from "../generated/moduleVersionControl.documents";
import { WorktreeChangesDocument } from "../generated/worktreeChanges.documents";
import { WorktreeMergePreviewDocument } from "../generated/worktreeMergePreview.documents";
import { WorktreeMergeRecoveryDocument } from "../generated/worktreeMergeRecovery.documents";
import { WorktreeStatusDocument } from "../generated/worktreeStatus.documents";
import {
  abortTaskWorktreeMerge,
  finishTaskWorktreeMerge,
  mergeTaskWorktree,
} from "../internal/changesTransport";
import { newOperationId } from "../internal/operationId";

export function WorktreeMergePreview({ taskId, active }: { taskId: string; active: boolean }) {
  const [destination, setDestination] = useState("");
  const [requestedDestination, setRequestedDestination] = useState<string | null>(null);
  const [busy, setBusy] = useState<"merge" | "finish" | "abort" | "refresh" | null>(null);
  const [confirming, setConfirming] = useState<"finish" | "abort" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const intent = useRef<{ key: string; operationId: string } | null>(null);
  const query = useQuery(WorktreeMergePreviewDocument, {
    client: studioApolloClient(),
    variables: { taskId, destinationBranch: requestedDestination },
    skip: !active,
    fetchPolicy: "network-only",
  });
  const preview = query.data?.worktree_merge_preview
    ?? query.previousData?.worktree_merge_preview;
  const recoveryQuery = useQuery(WorktreeMergeRecoveryDocument, {
    client: studioApolloClient(),
    variables: { taskId },
    skip: !active,
    fetchPolicy: "network-only",
  });
  const recovery = recoveryQuery.data
    ? recoveryQuery.data.worktree_merge_recovery
    : recoveryQuery.previousData?.worktree_merge_recovery;

  const refreshAffected = async () => {
    await studioApolloClient().refetchQueries({
      include: [
        WorktreeMergePreviewDocument,
        WorktreeMergeRecoveryDocument,
        WorktreeChangesDocument,
        ModuleVersionControlDocument,
        WorktreeStatusDocument,
      ],
    }).catch(() => undefined);
  };

  const refresh = (event: FormEvent) => {
    event.preventDefault();
    if (!destination) return;
    setError(null);
    setOutcome(null);
    if (destination === requestedDestination) void query.refetch();
    else setRequestedDestination(destination);
  };

  const merge = async () => {
    if (
      !preview?.source_commit
      || !preview.destination_branch
      || !preview.destination_commit
      || !preview.confirmation_token
    ) return;
    const key = JSON.stringify([
      taskId,
      preview.source_commit,
      preview.destination_branch,
      preview.destination_commit,
      preview.destination_checkout_identity,
      preview.confirmation_token,
    ]);
    if (intent.current?.key !== key) {
      intent.current = { key, operationId: newOperationId() };
    }
    setBusy("merge");
    setError(null);
    setOutcome(null);
    try {
      const result = await mergeTaskWorktree(
        taskId,
        intent.current.operationId,
        preview.destination_branch,
        preview.confirmation_token,
      );
      setOutcome(result.outcome);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Local merge failed.");
    } finally {
      await refreshAffected();
      setBusy(null);
    }
  };

  const settle = async (action: "finish" | "abort") => {
    if (!recovery) return;
    setBusy(action);
    setConfirming(null);
    setError(null);
    setOutcome(null);
    try {
      await (action === "finish"
        ? finishTaskWorktreeMerge(taskId, recovery.operation_id)
        : abortTaskWorktreeMerge(taskId, recovery.operation_id));
      intent.current = null;
      setOutcome(action === "finish" ? "finished" : "aborted");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Local merge ${action} failed.`);
    } finally {
      await refreshAffected();
      setBusy(null);
    }
  };

  const refreshMergeState = async () => {
    setBusy("refresh");
    setError(null);
    await refreshAffected();
    setBusy(null);
  };

  if (!active) return null;
  if (query.error && !preview) return <p className="text-xs text-lifecycle-danger">{query.error.message}</p>;
  if (!preview) return <p className="text-xs text-text-muted" role="status">Loading local merge preview...</p>;

  return (
    <section aria-label="Local merge preview" className="mt-3 border-t border-pane-border pt-3">
      <h3 className="font-medium text-text-primary">Local merge</h3>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
        <dt className="text-text-muted">Source</dt>
        <dd className="break-all text-text-primary">{preview.source_branch}</dd>
        <dt className="text-text-muted">Destination</dt>
        <dd className="break-all text-text-primary">{preview.destination_branch ?? "Select a destination"}</dd>
        <dt className="text-text-muted">Checkout</dt>
        <dd className="break-all text-text-primary">{preview.destination_checkout ?? "Unavailable"}</dd>
      </dl>

      {recovery ? (
        <section
          aria-label={recovery.outcome === "conflicted" ? "Merge conflict recovery" : "Local merge recovery"}
          className="mt-3 border border-lifecycle-attention/50 p-2"
        >
          <p className="text-xs text-text-primary">
            Merge {recovery.source_branch} into {recovery.destination_branch} in {recovery.destination_checkout}
          </p>
          {recovery.unmerged_paths.length > 0 ? (
            <ul aria-label="Unmerged files" className="mt-2 space-y-1 font-mono text-xs text-lifecycle-danger">
              {recovery.unmerged_paths.map(({ path }) => <li key={path}>{path}</li>)}
            </ul>
          ) : null}
          {recovery.reason ? <p className="mt-2 text-xs text-text-muted">{recovery.reason}</p> : null}
          {recovery.outcome === "conflicted" ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={recovery.unmerged_paths.length > 0 || busy !== null || Boolean(recoveryQuery.error)}
                onClick={() => setConfirming("finish")}
                className="border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50"
              >
                Finish merge
              </button>
              <button
                type="button"
                disabled={busy !== null || Boolean(recoveryQuery.error)}
                onClick={() => setConfirming("abort")}
                className="border border-lifecycle-danger/60 px-2 py-1 text-lifecycle-danger disabled:opacity-50"
              >
                Abort merge
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void refreshMergeState()}
                className="border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50"
              >
                {busy === "refresh" ? "Refreshing..." : "Refresh merge state"}
              </button>
            </div>
          ) : null}
          {confirming ? (
            <div
              aria-label={`Confirm ${confirming} merge`}
              className="mt-2 border border-pane-border p-2 text-xs"
              role="group"
            >
              <p className="text-text-primary">
                {confirming === "finish"
                  ? "Commit only the staged resolution. Ticketry will not stage files automatically."
                  : "Run Git merge abort for this matching merge. Ticketry will not hard reset the checkout."}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void settle(confirming)}
                  className="border border-pane-border px-2 py-1 text-text-primary"
                >
                  Confirm {confirming}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  className="border border-pane-border px-2 py-1 text-text-primary"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          {outcome === "finished" ? <p className="mt-2 text-xs text-lifecycle-success" role="status">Merge finished in {recovery.destination_checkout}.</p> : null}
          {outcome === "aborted" ? <p className="mt-2 text-xs text-text-muted" role="status">Merge aborted in {recovery.destination_checkout}.</p> : null}
          {recovery.outcome === "merged" && outcome !== "finished" ? <p className="mt-2 text-xs text-lifecycle-success" role="status">Merge completed outside Ticketry.</p> : null}
          {recovery.outcome === "aborted" && outcome !== "aborted" ? <p className="mt-2 text-xs text-text-muted" role="status">Merge was aborted outside Ticketry.</p> : null}
          {recoveryQuery.error ? <p className="mt-2 text-xs text-lifecycle-danger" role="alert">Unable to refresh merge recovery. Retry before acting.</p> : null}
        </section>
      ) : null}

      {!recovery && preview.requires_destination_selection ? (
        <form className="mt-2 flex flex-wrap gap-2" onSubmit={refresh}>
          <select
            aria-label="Local merge destination"
            className="min-w-0 border border-pane-border bg-pane-bg px-2 py-1 text-text-primary"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
          >
            <option value="">Select an existing local branch</option>
            {preview.destinations.map((candidate) => (
              <option key={candidate.branch} value={candidate.branch}>
                {candidate.branch} - {candidate.checkout ?? "not checked out"}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!destination || query.loading}
            className="border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50"
          >
            Preview destination
          </button>
        </form>
      ) : null}

      {!recovery && !preview.ready ? (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void refreshMergeState()}
          className="mt-2 border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50"
        >
          {busy === "refresh" ? "Refreshing..." : "Refresh merge eligibility"}
        </button>
      ) : null}
      {!recovery && preview.reason ? <p className="mt-2 text-xs text-lifecycle-danger" role="alert">{preview.reason}</p> : null}
      {!recovery && preview.ready ? <p className="mt-2 text-xs text-lifecycle-success" role="status">Ready to merge locally</p> : null}
      {!recovery && preview.ready ? (
        <button
          type="button"
          aria-busy={busy === "merge"}
          disabled={busy !== null}
          onClick={() => void merge()}
          className="mt-2 border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50"
        >
          {busy === "merge" ? "Merging..." : `Merge into ${preview.destination_branch}`}
        </button>
      ) : null}
      {error ? <p className="mt-2 text-xs text-lifecycle-danger" role="alert">{error}</p> : null}
      {outcome === "fast_forwarded" ? (
        <p className="mt-2 text-xs text-lifecycle-success" role="status">Fast-forwarded {preview.destination_branch}.</p>
      ) : null}
      {outcome === "already_integrated" ? (
        <p className="mt-2 text-xs text-lifecycle-success" role="status">Destination already contains this commit.</p>
      ) : null}
      {outcome === "merged" ? (
        <p className="mt-2 text-xs text-lifecycle-success" role="status">Merged {preview.source_branch} into {preview.destination_branch}.</p>
      ) : null}
    </section>
  );
}
