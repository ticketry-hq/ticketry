import { useQuery } from "@apollo/client/react";
import { useEffect, type ReactNode } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";

import { studioApolloClient } from "../../../../shared/apollo/client";
import { PaneResizeHandle } from "../../../../shared/ui/PaneResizeHandle";
import { createApolloStore } from "../../../../shared/apollo/localState";
import { ModuleFileDiffDocument } from "../generated/moduleFileDiff.documents";
import { WorktreeFileDiffDocument } from "../generated/worktreeFileDiff.documents";
import { ChangedFilesList } from "./ChangedFilesList";
import { changedFileBadge } from "./changedFileBadge";
import type { ChangedFileRow } from "./changedFileGroups";
import { FileDiffSurface } from "./FileDiffSurface";

type ReviewSelection = { selectedByCheckout: Record<string, string | null> };

const reviewSelection = createApolloStore<ReviewSelection>(
  "changes-file-review-selection",
  () => ({ selectedByCheckout: {} }),
);

/**
 * The review surface: changed files beside the diff of the selected file.
 *
 * Files and diff own the window. Branch state and the commands that change it
 * live in the toolbar above and the inspector beside, so reading a change never
 * competes for space with shipping one.
 */
export function ChangesFileReview({
  checkoutKey,
  toolbar,
  inspector,
  header,
  taskId,
  moduleId,
  files,
  insertions,
  deletions,
  truncated,
  label,
  countLabel,
  emptyMessage,
  loading = false,
}: {
  checkoutKey: string;
  toolbar: ReactNode;
  inspector?: ReactNode;
  header?: ReactNode;
  taskId?: string;
  moduleId?: string;
  files: readonly ChangedFileRow[];
  insertions: number;
  deletions: number;
  truncated: boolean;
  label: string;
  /** Names what the count is, e.g. cumulative changes rather than plain files. */
  countLabel?: string;
  emptyMessage: string;
  loading?: boolean;
}) {
  const selectedPath = reviewSelection((state) => state.selectedByCheckout[checkoutKey] ?? null);
  const index = files.findIndex(({ path }) => path === selectedPath);
  const file = index === -1 ? undefined : files[index];
  const selectedDocument = taskId ? WorktreeFileDiffDocument : ModuleFileDiffDocument;
  const variables = taskId ? { taskId, path: selectedPath ?? "" } : { moduleId, path: selectedPath ?? "" };
  const diffQuery = useQuery(selectedDocument as never, {
    client: studioApolloClient(),
    variables,
    skip: !file,
    fetchPolicy: "network-only",
  });

  const select = (path: string | null) => reviewSelection.setState((state) => ({
    selectedByCheckout: { ...state.selectedByCheckout, [checkoutKey]: path },
  }));

  useEffect(() => {
    if (!loading && selectedPath && index === -1) select(null);
  }, [checkoutKey, index, loading, selectedPath]);

  const diff = (diffQuery.data as { worktree_file_diff?: Diff; module_file_diff?: Diff } | undefined)?.worktree_file_diff
    ?? (diffQuery.data as { module_file_diff?: Diff } | undefined)?.module_file_diff;
  const badge = file ? changedFileBadge(file.status) : null;
  const step = (delta: number) => {
    if (files.length === 0) return;
    const next = index === -1 ? 0 : (index + delta + files.length) % files.length;
    select(files[next].path);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="changes-workspace-scroll">
      {toolbar}
      <div className="flex min-h-0 flex-1" data-testid="changes-workspace">
        <PanelGroup direction="horizontal" className="h-full min-w-0 flex-1">
          <Panel defaultSize={32} minSize={20} order={1}>
            <section
              aria-label="Changed files"
              className="flex h-full min-w-0 flex-col overflow-hidden"
              data-testid="changes-files-column"
            >
              <div className="flex h-8 shrink-0 items-center justify-between border-b border-pane-border px-3 text-xs text-text-secondary">
                <span>{loading ? "Loading changes..." : countLabel ?? `${files.length} files`}</span>
                {loading ? null : (
                  <span className="font-mono">
                    <span className="text-lifecycle-success">+{insertions}</span>{" "}
                    <span className="text-lifecycle-danger">-{deletions}</span>
                  </span>
                )}
              </div>
              {header ? <div className="shrink-0">{header}</div> : null}
              {loading ? null : files.length === 0 ? (
                <p className="p-3 text-sm text-text-muted">{emptyMessage}</p>
              ) : (
                <div className="min-h-0 flex-1 overflow-auto">
                  <ChangedFilesList
                    files={files}
                    label={label}
                    descriptionPrefix={checkoutKey}
                    selectedPath={selectedPath}
                    onSelect={select}
                  />
                </div>
              )}
              {truncated ? <p className="p-3 text-xs text-lifecycle-attention" role="status">The changed-file limit was reached.</p> : null}
            </section>
          </Panel>
          <PaneResizeHandle
            label="Resize changed files and diff"
            testId="changes-diff-resize-handle"
          />
          <Panel defaultSize={68} minSize={30} order={2}>
            <section
              aria-label="Selected file diff"
              className="flex h-full min-w-0 flex-col overflow-hidden"
              data-testid="changes-diff-column"
            >
              <div className="flex h-8 shrink-0 items-center gap-2 border-b border-pane-border px-3 font-mono text-xs">
                {badge ? (
                  <span aria-hidden="true" className={`shrink-0 font-bold ${badge.toneClass}`}>{badge.letter}</span>
                ) : null}
                <h3 className="min-w-0 flex-1 truncate text-text-primary">
                  {file?.path ?? "No file selected"}
                </h3>
                {file ? (
                  <>
                    <span className="shrink-0 text-text-muted">{index + 1} / {files.length}</span>
                    <button
                      type="button"
                      aria-label="Previous changed file"
                      onClick={() => step(-1)}
                      className="shrink-0 px-1 text-text-muted hover:text-text-primary"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      aria-label="Next changed file"
                      onClick={() => step(1)}
                      className="shrink-0 px-1 text-text-muted hover:text-text-primary"
                    >
                      ›
                    </button>
                  </>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-3">
                {!file ? <p className="text-sm text-text-muted">Select a file to review its diff.</p>
                  : diffQuery.error ? <p className="text-sm text-lifecycle-danger" role="alert">Unable to load this file diff.</p>
                    : diffQuery.loading ? <p className="text-sm text-text-muted" role="status">Loading diff...</p>
                      : diff?.binary ? <p className="text-sm text-text-muted" role="status">Binary file; no text diff is available.</p>
                        : <>
                            {diff?.truncated ? <p className="mb-2 text-sm text-lifecycle-attention" role="status">This diff is truncated.</p> : null}
                            {diff?.patch
                              ? <FileDiffSurface patch={diff.patch} />
                              : <p className="text-sm text-text-muted" role="status">No textual changes to display.</p>}
                          </>}
              </div>
            </section>
          </Panel>
        </PanelGroup>
        {inspector}
      </div>
    </div>
  );
}

type Diff = { binary: boolean; patch: string; truncated: boolean };
