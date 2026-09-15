import { useQuery } from "@apollo/client/react";
import { useEffect } from "react";

import { studioApolloClient } from "../../../../shared/apollo/client";
import { createApolloStore } from "../../../../shared/apollo/localState";
import { ModuleFileDiffDocument } from "../generated/moduleFileDiff.documents";
import { WorktreeFileDiffDocument } from "../generated/worktreeFileDiff.documents";
import { ChangedFilesList } from "./ChangedFilesList";

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
    <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)]" data-testid="changes-file-review">
      <div className="min-w-0">
        <div className="mb-2 flex items-baseline justify-between text-xs text-text-muted">
          <span>{files.length} files</span>
          <span>+{insertions} -{deletions}</span>
        </div>
        <ChangedFilesList
          files={files}
          label={label}
          descriptionPrefix={checkoutKey}
          selectedPath={selectedPath}
          onSelect={(path) => reviewSelection.setState((state) => ({
            selectedByCheckout: { ...state.selectedByCheckout, [checkoutKey]: path },
          }))}
        />
        {truncated ? <p className="mt-2 text-xs text-lifecycle-attention" role="status">The changed-file limit was reached.</p> : null}
      </div>
      <section aria-label="Selected file diff" className="min-h-32 min-w-0 border border-pane-border p-3">
        {!file ? <p className="text-sm text-text-muted">Select a file to review its diff.</p>
          : diffQuery.error ? <p className="text-sm text-lifecycle-danger" role="alert">Unable to load this file diff.</p>
            : diffQuery.loading ? <p className="text-sm text-text-muted" role="status">Loading diff...</p>
              : diff?.binary ? <p className="text-sm text-text-muted" role="status">Binary file; no text diff is available.</p>
                : diff?.truncated ? <p className="text-sm text-lifecycle-attention" role="status">This diff is truncated.</p>
                  : diff?.patch ? <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap font-mono text-xs text-text-primary">{diff.patch}</pre>
                    : <p className="text-sm text-text-muted" role="status">No textual changes to display.</p>}
      </section>
    </div>
  );
}

type Diff = { binary: boolean; patch: string; truncated: boolean };
