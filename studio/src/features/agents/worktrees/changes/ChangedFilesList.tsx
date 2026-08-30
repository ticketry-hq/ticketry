import { changePresentation } from "./changePresentation";

interface ChangedFileRow {
  path: string;
  previous_path?: string | null;
  status: string;
}

export function ChangedFilesList({
  files,
  label,
  descriptionPrefix,
}: {
  files: readonly ChangedFileRow[];
  label: string;
  descriptionPrefix: string;
}) {
  return (
    <ul
      aria-label={label}
      className="divide-y divide-pane-border border border-pane-border"
    >
      {files.map((file, index) => {
        const presentation = changePresentation(file.status);
        const descriptionId = `${descriptionPrefix}-${index}-description`;
        return (
          <li
            key={file.path}
            aria-label={`${file.path}: ${presentation.label}`}
            aria-describedby={descriptionId}
            className="flex min-w-0 items-center gap-3 px-3 py-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-text-primary">
                {file.path}
              </span>
              {file.previous_path ? (
                <span className="block truncate text-xs text-text-muted">
                  from {file.previous_path}
                </span>
              ) : null}
            </span>
            <span
              className={`shrink-0 text-xs font-medium ${presentation.toneClass}`}
            >
              {presentation.label}
            </span>
            <span id={descriptionId} className="sr-only">
              {presentation.explanation}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
