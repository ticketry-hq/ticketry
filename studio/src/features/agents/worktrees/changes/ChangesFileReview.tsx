import { useQuery } from "@apollo/client/react";
import { useEffect } from "react";

import { studioApolloClient } from "../../../../shared/apollo/client";
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
  taskId,
  moduleId,
  files,
  insertions,
  deletions,
  truncated,
  label,
}: {
  checkoutKey: string;
  taskId?: string;
  moduleId?: string;
  files: readonly FileRow[];
  insertions: number;
  deletions: number;
  truncated: boolean;
  label: string;
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
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="changes-file-review">
      <div className="flex min-w-0 shrink-0 flex-col">
        <div className="mb-2 flex items-baseline justify-between text-xs text-text-muted">
          <span>{files.length} files</span>
          <span>+{insertions} -{deletions}</span>
        </div>
        <div className="max-h-64 overflow-auto">
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
        {truncated ? <p className="mt-2 text-xs text-lifecycle-attention" role="status">The changed-file limit was reached.</p> : null}
      </div>
      <section aria-label="Selected file diff" className="flex min-h-32 min-w-0 flex-col overflow-hidden border border-pane-border p-3 lg:min-h-0">
        {file ? <h3 className="mb-2 truncate font-mono text-xs text-text-muted">{file.path}</h3> : null}
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
    </div>
  );
}

type Diff = { binary: boolean; patch: string; truncated: boolean };
