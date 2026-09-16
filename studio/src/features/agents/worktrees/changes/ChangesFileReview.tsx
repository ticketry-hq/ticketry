import { useQuery } from "@apollo/client/react";
import { useEffect, type ReactNode } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";

import { studioApolloClient } from "../../../../shared/apollo/client";
import { PaneResizeHandle } from "../../../../shared/ui/PaneResizeHandle";
import { createApolloStore } from "../../../../shared/apollo/localState";
import { ModuleFileDiffDocument } from "../generated/moduleFileDiff.documents";
import { WorktreeFileDiffDocument } from "../generated/worktreeFileDiff.documents";
import { ChangedFilesList } from "./ChangedFilesList";
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
  checkouts,
  header,
  taskId,
  moduleId,
  files,
  insertions,
  deletions,
  truncated,
  label,
  emptyMessage,
}: {
  checkoutKey: string;
  checkouts: ReactNode;
  header: ReactNode;
  taskId?: string;
  moduleId?: string;
  files: readonly FileRow[];
  insertions: number;
  deletions: number;
  truncated: boolean;
  label: string;
  emptyMessage: string;
}) {
  const selectedPath = reviewSelection((state) => state.selectedByCheckout[checkoutKey] ?? null);
  const file = files.find(({ path }) => path === selectedPath);
  const selectedDocument = taskId ? WorktreeFileDiffDocument : ModuleFileDiffDocument;
  const variables = taskId ? { taskId, path: selectedPath ?? "" } : { moduleId, path: selectedPath ?? "" };
  const diffQuery = useQuery(selectedDocument as never, {
    client: studioApolloClient(),
    variables,
    skip: !file,
    fetchPolicy: "network-only",
  });

  useEffect(() => {
    if (selectedPath && !file) {
      reviewSelection.setState((state) => ({
        selectedByCheckout: { ...state.selectedByCheckout, [checkoutKey]: null },
      }));
    }
  }, [checkoutKey, file, selectedPath]);

  const diff = (diffQuery.data as { worktree_file_diff?: Diff; module_file_diff?: Diff } | undefined)?.worktree_file_diff
    ?? (diffQuery.data as { module_file_diff?: Diff } | undefined)?.module_file_diff;

  return (
    <div className="h-full min-h-0 overflow-x-auto" data-testid="changes-workspace-scroll">
      <div className="h-full min-w-[56rem]" data-testid="changes-workspace">
        <PanelGroup direction="horizontal" className="h-full w-full">
          <Panel defaultSize={22} minSize={18} order={1}>
            <section
              aria-label="Worktree checkouts"
              className="h-full min-w-0 overflow-hidden"
              data-testid="changes-checkouts-column"
            >
              {checkouts}
            </section>
          </Panel>
          <PaneResizeHandle
            label="Resize checkouts and changed files"
            testId="changes-checkouts-resize-handle"
          />
          <Panel defaultSize={28} minSize={24} order={2}>
            <section
              aria-label="Changed files"
              className="flex h-full min-w-0 flex-col overflow-hidden p-3"
              data-testid="changes-files-column"
            >
              <div className="shrink-0">{header}</div>
              <div className="mb-2 flex items-baseline justify-between text-xs text-text-muted">
                <span>{files.length} files</span>
                <span>+{insertions} -{deletions}</span>
              </div>
              {files.length === 0 ? (
                <p className="text-sm text-text-muted">{emptyMessage}</p>
              ) : (
                <div className="min-h-0 flex-1 overflow-auto">
                  <ChangedFilesList
                    files={files}
                    label={label}
                    descriptionPrefix={checkoutKey}
                    selectedPath={selectedPath}
                    onSelect={(path) => reviewSelection.setState((state) => ({
                      selectedByCheckout: { ...state.selectedByCheckout, [checkoutKey]: path },
                    }))}
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
          <Panel defaultSize={50} minSize={30} order={3}>
            <section
              aria-label="Selected file diff"
              className="flex h-full min-w-0 flex-col overflow-hidden p-3"
              data-testid="changes-diff-column"
            >
              <h3 className="mb-2 h-4 shrink-0 truncate font-mono text-xs text-text-muted">
                {file?.path ?? "No file selected"}
              </h3>
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
            </section>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}

type Diff = { binary: boolean; patch: string; truncated: boolean };
