import { useEffect, useRef, useState, type ReactNode } from "react";
import { useCheckoutChanges, useCheckoutFileDiff } from "../queries";
import type { ChangedFile, CheckoutRef } from "../types";
import { ChangedFilesList } from "./ChangedFilesList";
import { ActionFooter } from "./ActionFooter";
import { FileDiffSurface } from "./FileDiffSurface";
import { PullRequestVerdictBanner } from "./PullRequestVerdictBanner";
import { absenceMessage, checkoutCopy } from "./checkoutCopy";
import { countsLabel, statusLabel, summaryLabel } from "./changePresentation";
import { reviewFailureMessage } from "./reviewFailure";

/**
 * The Changes tab's review state (ADR 0012, ADR 0013).
 *
 * One panel serves both checkout kinds: a task worktree and a module base
 * checkout differ only in the `CheckoutRef` handed in, which fixes the cache
 * entry, the request, and the wording. The review area is read-only: the
 * reviewer picks a file to look at, and that is the only choice it offers.
 * The one write is the footer's action, and it takes every changed file, so
 * nothing here excludes or stages anything. Status is fetched on demand — on
 * mount, on Refresh, and after a commit — never polled.
 */
export function ChangesPanel({
  checkout,
  active = true,
}: {
  checkout: CheckoutRef;
  active?: boolean;
}) {
  const copy = checkoutCopy(checkout.kind);
  const changesQuery = useCheckoutChanges(checkout);
  const changes = changesQuery.data;
  const files = changes?.kind === "changes" ? changes.files : [];
  const wasInactive = useRef(false);

  // Studio keeps this panel mounted to preserve the selected diff. Remember a
  // hidden interval so returning to the tab still performs its lazy read.
  useEffect(() => {
    if (!active) {
      wasInactive.current = true;
      return;
    }
    if (wasInactive.current) {
      wasInactive.current = false;
      void changesQuery.refetch();
    }
  }, [active, changesQuery.refetch]);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // A file that stopped changing — committed, reverted, deleted — must not
  // leave a stale diff on screen after a refresh.
  useEffect(() => {
    setSelectedPath((current) =>
      current && files.some((file) => file.path === current) ? current : null,
    );
  }, [files]);

  const selectedFile = files.find((file) => file.path === selectedPath) ?? null;
  const diffQuery = useCheckoutFileDiff(checkout, selectedPath);

  return (
    <div
      data-testid="changes-panel"
      data-checkout={checkout.kind}
      className="flex h-full min-h-0 flex-col text-sm"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-pane-border px-3 py-2">
        <div className="min-w-0 flex-1">
          {changes?.kind === "changes" ? (
            <>
              <div className="truncate font-mono text-xs text-text-primary">
                {changes.branch}
                {/* A base checkout has nothing to be compared against, so it
                    shows the branch it is on and stops there. */}
                {changes.base_branch && (
                  <span className="text-text-muted">
                    {" "}
                    → {changes.base_branch}
                  </span>
                )}
              </div>
              <div className="text-xs text-text-secondary">
                {summaryLabel(
                  changes.file_count,
                  changes.insertions,
                  changes.deletions,
                )}
              </div>
            </>
          ) : (
            <div className="text-xs text-text-secondary">{copy.heading}</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void changesQuery.refetch()}
          disabled={changesQuery.isFetching}
          className="shrink-0 border border-pane-border px-2 py-1 text-xs text-text-secondary hover:bg-pane-title disabled:opacity-50"
        >
          {changesQuery.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <PullRequestVerdictBanner
        verdict={changes?.pull_request}
        checkout={checkout.kind === "worktree" ? checkout : null}
        uncommittedFileCount={changes?.file_count ?? 0}
        unpushedCommitCount={changes?.unpushed_commit_count ?? 0}
      />

      <PanelBody
        loading={changesQuery.isLoading}
        error={changesQuery.isError ? changesQuery.error : null}
        absence={
          changes && changes.kind !== "changes"
            ? absenceMessage(checkout.kind, changes.reason ?? "")
            : null
        }
        cleanMessage={copy.clean}
        files={files}
        selectedPath={selectedPath}
        onSelect={setSelectedPath}
        selectedSummary={
          selectedFile
            ? `${statusLabel(selectedFile.status)} · ${countsLabel(selectedFile)}`
            : null
        }
        diffLoading={diffQuery.isLoading}
        diffError={diffQuery.isError ? diffQuery.error : null}
        patch={diffQuery.data?.patch ?? null}
        patchTruncated={diffQuery.data?.truncated ?? false}
      />

      {/* One footer for both checkout kinds (ADR 0013). Which action it leads
          with is the checkout's decision, made in `actionPlans`. It stays
          mounted once the checkout is readable so its safety copy and step
          plan are visible before anything runs. */}
      {changes?.kind === "changes" && (
        <ActionFooter checkout={checkout} hasChanges={files.length > 0} />
      )}
    </div>
  );
}

function PanelBody({
  loading,
  error,
  absence,
  cleanMessage,
  files,
  selectedPath,
  onSelect,
  selectedSummary,
  diffLoading,
  diffError,
  patch,
  patchTruncated,
}: {
  loading: boolean;
  error: unknown;
  absence: string | null;
  cleanMessage: string;
  files: readonly ChangedFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  selectedSummary: string | null;
  diffLoading: boolean;
  diffError: unknown;
  patch: string | null;
  patchTruncated: boolean;
}) {
  if (loading) return <Notice>Reading this checkout…</Notice>;
  if (error) return <Notice tone="danger">{reviewFailureMessage(error)}</Notice>;
  if (absence !== null) return <Notice>{absence}</Notice>;
  if (files.length === 0) return <Notice>{cleanMessage}</Notice>;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-72 min-w-0 shrink-0 flex-col border-r border-pane-border">
        <ChangedFilesList
          files={files}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {selectedPath === null ? (
          <Notice>Select a file to read its diff.</Notice>
        ) : (
          <>
            <div className="flex shrink-0 items-baseline gap-3 border-b border-pane-border px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary">
                {selectedPath}
              </span>
              {selectedSummary && (
                <span className="shrink-0 text-xs text-text-muted">
                  {selectedSummary}
                </span>
              )}
            </div>
            {diffLoading && <Notice>Reading the diff…</Notice>}
            {diffError !== null && !diffLoading && (
              <Notice tone="danger">{reviewFailureMessage(diffError)}</Notice>
            )}
            {patch !== null && !diffLoading && !diffError && (
              <>
                {patchTruncated && (
                  <div
                    data-testid="patch-truncated-notice"
                    className="shrink-0 border-b border-pane-border px-3 py-1 text-xs text-lifecycle-attention"
                  >
                    This diff is too large to show in full. The rest is only
                    visible in a terminal.
                  </div>
                )}
                <FileDiffSurface patch={patch} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Notice({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "danger";
}) {
  return (
    <div
      role="status"
      className={`flex min-h-0 flex-1 items-start px-3 py-3 text-xs ${
        tone === "danger" ? "text-lifecycle-danger" : "text-text-muted"
      }`}
    >
      {children}
    </div>
  );
}
