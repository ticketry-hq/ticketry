import { useState } from "react";
import { studioRuntime, type StudioRuntime } from "../../../runtime";
import { isAbsoluteFolderPath } from "../../studio/lib/moduleFolderPath";
import { recentModuleFolders, useModuleLinks } from "../../module-links";

export function useModuleFolderSelection({
  initialValue = "",
  runtime = studioRuntime(),
}: {
  initialValue?: string;
  runtime?: StudioRuntime;
} = {}) {
  // Folders already linked to some Module are the ones worth offering again.
  const recentFolders = recentModuleFolders(useModuleLinks());
  const [value, setValue] = useState(initialValue);
  const [highlight, setHighlight] = useState(-1);
  const isValid = isAbsoluteFolderPath(value);

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
    isValid,
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
  ariaDescribedBy,
  ariaInvalid = false,
  disabled = false,
  inputId,
  pickerInline = false,
  placeholder = "Local folder (optional)",
}: {
  selection: ModuleFolderSelectionState;
  autoFocus?: boolean;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
  disabled?: boolean;
  inputId?: string;
  pickerInline?: boolean;
  placeholder?: string;
}) {
  const showPathError =
    selection.value.trim().length > 0 && !selection.isValid;
  const picker = selection.runtime.capabilities.nativeFolderPicker ? (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void selection.pickFolder()}
      className={`border border-pane-border bg-pane-bg px-3 py-1 ${
        pickerInline ? "shrink-0" : "mt-3"
      }`}
    >
      Pick Folder
    </button>
  ) : null;

  return (
    <>
      <div className={pickerInline ? "flex items-stretch gap-2" : undefined}>
        <input
          id={inputId}
          autoFocus={autoFocus}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          value={selection.value}
          onChange={(event) => selection.setValue(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          aria-invalid={showPathError || ariaInvalid || undefined}
          className={`${pickerInline ? "min-w-0 flex-1" : "w-full"} bg-pane-bg px-2 py-1 font-mono text-sm outline-none ring-1 ring-pane-border focus:ring-focus-accent`}
        />
        {pickerInline ? picker : null}
      </div>
      {showPathError ? (
        <p className="mt-2 text-xs text-lifecycle-danger" role="alert">
          Enter the full folder path, starting from the filesystem root.
        </p>
      ) : null}
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
      {!pickerInline ? picker : null}
    </>
  );
}
