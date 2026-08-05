import { useState } from "react";
import { studioRuntime, type StudioRuntime } from "../../../runtime";

interface FolderProfile {
  module_links?: Array<{ module_id: string; path: string }>;
}

export function useModuleFolderSelection({
  profiles,
  recentProfileIndex,
  initialValue = "",
  runtime = studioRuntime(),
}: {
  profiles: FolderProfile[];
  recentProfileIndex: number | null;
  initialValue?: string;
  runtime?: StudioRuntime;
}) {
  const profile =
    recentProfileIndex !== null ? profiles[recentProfileIndex] : null;
  const recentFolders = Array.from(
    new Set(
      (profile?.module_links ?? [])
        .map((link) => link.path)
        .reverse()
        .filter((path) => path.trim().length > 0),
    ),
  );
  const [value, setValue] = useState(initialValue);
  const [highlight, setHighlight] = useState(-1);

  function moveNext(): void {
    if (recentFolders.length === 0) return;
    setHighlight((current) => (current + 1) % recentFolders.length);
  }

  function movePrevious(): void {
    if (recentFolders.length === 0) return;
    setHighlight((current) =>
      current <= 0 ? recentFolders.length - 1 : current - 1,
    );
  }

  function commitHighlighted(): boolean {
    if (highlight < 0 || highlight >= recentFolders.length) return false;
    setValue(recentFolders[highlight]);
    setHighlight(-1);
    return true;
  }

  async function pickFolder(): Promise<void> {
    const picked = await runtime.pickFolder();
    if (picked !== null) {
      setValue(picked);
      setHighlight(-1);
    }
  }

  return {
    value,
    setValue,
    recentFolders,
    highlight,
    setHighlight,
    moveNext,
    movePrevious,
    commitHighlighted,
    pickFolder,
    runtime,
  };
}

type ModuleFolderSelectionState = ReturnType<typeof useModuleFolderSelection>;

export function ModuleFolderSelection({
  selection,
  autoFocus = false,
  ariaLabel,
  placeholder = "Local folder (optional)",
}: {
  selection: ModuleFolderSelectionState;
  autoFocus?: boolean;
  ariaLabel?: string;
  placeholder?: string;
}) {
  return (
    <>
      <input
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        value={selection.value}
        onChange={(event) => selection.setValue(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="w-full bg-pane-bg px-2 py-1 font-mono text-sm outline-none ring-1 ring-pane-border focus:ring-focus-accent"
      />
      {selection.recentFolders.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-bold uppercase tracking-wider text-text-muted">
            Recent folders
          </div>
          <ul
            aria-label="Recent folders"
            className="border border-pane-border bg-pane-bg"
          >
            {selection.recentFolders.map((folder, index) => (
              <li
                key={folder}
                onClick={() => {
                  selection.setValue(folder);
                  selection.setHighlight(-1);
                }}
                className={`cursor-pointer truncate px-2 py-1 font-mono text-sm ${
                  index === selection.highlight
                    ? "bg-selection-bg text-text-primary"
                    : "hover:bg-pane-title"
                }`}
              >
                {folder}
              </li>
            ))}
          </ul>
        </div>
      )}
      {selection.runtime.capabilities.nativeFolderPicker && (
        <button
          type="button"
          onClick={() => void selection.pickFolder()}
          className="mt-3 rounded border border-pane-border bg-pane-bg px-3 py-1"
        >
          Pick Folder
        </button>
      )}
    </>
  );
}
