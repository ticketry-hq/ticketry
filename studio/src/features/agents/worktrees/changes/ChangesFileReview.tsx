import { useQuery } from "@apollo/client/react";
import { useEffect, type ReactNode } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";

import { studioApolloClient } from "../../../../shared/apollo/client";
import { PaneResizeHandle } from "../../../../shared/ui/PaneResizeHandle";
import { createApolloStore } from "../../../../shared/apollo/localState";
import { ModuleFileDiffDocument } from "../generated/moduleFileDiff.documents";
import { WorktreeFileDiffDocument } from "../generated/worktreeFileDiff.documents";
import { ChangedFilesList } from "./ChangedFilesList";
import { DiffReadingRegion } from "./DiffReadingRegion";
import { FileDiffSurface } from "./FileDiffSurface";

type FileRow = {
  path: string;
  previous_path?: string | null;
  status: string;
  binary?: boolean;
  insertions?: number | null;
  deletions?: number | null;
};

type ReviewSelection = { selectedByCheckout: Record<string, string | null> };

const reviewSelection = createApolloStore<ReviewSelection>(
  "changes-file-review-selection",
  () => ({ selectedByCheckout: {} }),
);

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
  emptyMessage,
  loading = false,
}: {
  checkoutKey: string;
  toolbar?: ReactNode;
  inspector?: ReactNode;
  header?: ReactNode;
  taskId?: string;
  moduleId?: string;
  files: readonly FileRow[];
  insertions: number;
  deletions: number;
  truncated: boolean;
  label: string;
  emptyMessage: string;
  loading?: boolean;
}) {
  const selectedPath = reviewSelection((state) => state.selectedByCheckout[checkoutKey] ?? null);
  const selectedIndex = files.findIndex(({ path }) => path === selectedPath);
  const file = selectedIndex === -1 ? undefined : files[selectedIndex];
  const selectedDocument = taskId ? WorktreeFileDiffDocument : ModuleFileDiffDocument;
  const variables = taskId ? { taskId, path: selectedPath ?? "" } : { moduleId, path: selectedPath ?? "" };
  const diffQuery = useQuery(selectedDocument as never, {
    client: studioApolloClient(),
    variables,
    skip: !file,
    fetchPolicy: "network-only",
  });

  useEffect(() => {
    if (!loading && selectedPath && !file) {
      reviewSelection.setState((state) => ({
        selectedByCheckout: { ...state.selectedByCheckout, [checkoutKey]: null },
      }));
    }
  }, [checkoutKey, file, loading, selectedPath]);

  const diff = (diffQuery.data as { worktree_file_diff?: Diff; module_file_diff?: Diff } | undefined)?.worktree_file_diff
    ?? (diffQuery.data as { module_file_diff?: Diff } | undefined)?.module_file_diff;
  const select = (path: string | null) => reviewSelection.setState((state) => ({
    selectedByCheckout: { ...state.selectedByCheckout, [checkoutKey]: path },
  }));
  const step = (delta: number) => {
    if (files.length === 0) return;
    const nextIndex = (selectedIndex + delta + files.length) % files.length;
    select(files[nextIndex].path);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="changes-workspace-scroll">
      {toolbar}
      <div className="flex min-h-0 flex-1" data-testid="changes-workspace">
        <PanelGroup direction="horizontal" className="h-full min-w-0 flex-1">
          <Panel defaultSize={35} minSize={24} order={1}>
            <section
              aria-label="Changed files"
              className="flex h-full min-w-0 flex-col overflow-hidden p-3"
              data-testid="changes-files-column"
            >
              <div className="shrink-0">{header}</div>
              {loading ? <p role="status" className="text-xs text-text-muted">Loading changes...</p> : null}
              {!loading && <div className="mb-2 flex items-baseline justify-between text-xs text-text-muted">
                <span>{files.length} files</span>
                <span>+{insertions} -{deletions}</span>
              </div>}
              {loading ? null : (
                <div className="min-h-0 flex-1 overflow-auto" data-testid="changes-files-scroll">
                  <ChangedFilesList
                    checkoutKey={checkoutKey}
                    files={files}
                    label={label}
                    descriptionPrefix={checkoutKey}
                    selectedPath={selectedPath}
                    emptyMessage={emptyMessage}
                    onSelect={select}
                  />
                </div>
              )}
              {truncated ? <p className="mt-2 text-xs text-lifecycle-attention" role="status">The changed-file limit was reached.</p> : null}
            </section>
          </Panel>
          <PaneResizeHandle
            label="Resize changed files and diff"
            testId="changes-diff-resize-handle"
          />
          <Panel defaultSize={65} minSize={30} order={2}>
            <section
              aria-label="Selected file diff"
              className="flex h-full min-w-0 flex-col overflow-hidden p-3"
              data-testid="changes-diff-column"
            >
              <div className="mb-2 flex h-4 shrink-0 items-center gap-2 font-mono text-xs text-text-muted">
                <h3 className="min-w-0 flex-1 truncate">{file?.path ?? "No file selected"}</h3>
                {file ? (
                  <>
                    <span className="shrink-0">{selectedIndex + 1} / {files.length}</span>
                    <button
                      type="button"
                      aria-label="Previous changed file"
                      className="shrink-0 px-1 hover:text-text-primary focus-visible:ring-1 focus-visible:ring-focus-accent"
                      onClick={() => step(-1)}
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      aria-label="Next changed file"
                      className="shrink-0 px-1 hover:text-text-primary focus-visible:ring-1 focus-visible:ring-focus-accent"
                      onClick={() => step(1)}
                    >
                      ›
                    </button>
                  </>
                ) : null}
              </div>
              <DiffReadingRegion>
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
              </DiffReadingRegion>
            </section>
          </Panel>
        </PanelGroup>
        {inspector}
      </div>
    </div>
  );
}

type Diff = { binary: boolean; patch: string; truncated: boolean };
