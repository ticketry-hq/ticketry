import { useId, type KeyboardEvent } from "react";
import { MODAL_ACTIONS } from "../../shared/navigation/modalActions";
import { resolveModalKeymapAction } from "../../shared/navigation/keymapResolver";
import { ModuleFolderSelection } from "../agents/terminal/ModuleFolderSelection";
import type { ModuleCreation } from "./useModuleCreation";

/** Shared accessible inputs for the modal and Module Manager's inline editor. */
export function ModuleCreationFields({ creation, autoFocus = true }: {
  creation: ModuleCreation;
  autoFocus?: boolean;
}) {
  const { name, setName, busy, createdModuleId, folderSelection, folderError, error } = creation;
  const moduleNameId = useId();
  const moduleNameHintId = useId();
  const moduleFolderId = useId();
  const moduleFolderHintId = useId();
  const moduleFolderErrorId = useId();

  function handleKey(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.defaultPrevented || !(event.target instanceof HTMLInputElement)) return;
    const folderInput = event.target.id === moduleFolderId;
    const actions = new Set<string>([MODAL_ACTIONS.confirm]);
    if (folderInput && folderSelection.recentFolders.length > 0) {
      actions.add(MODAL_ACTIONS.previous);
      actions.add(MODAL_ACTIONS.next);
    }
    const action = resolveModalKeymapAction(event.nativeEvent, actions);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (folderInput) creation.handleAction(action);
    else void creation.submit();
  }

  return <div aria-busy={busy} onKeyDown={handleKey}>
      <label
        htmlFor={moduleNameId}
        className="text-xs font-bold uppercase tracking-wider text-text-secondary"
      >
        Module name
      </label>
      <input
        id={moduleNameId}
        data-coach-anchor="module-name"
        aria-describedby={moduleNameHintId}
        autoFocus={autoFocus}
        disabled={busy || createdModuleId !== null}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Module name"
        spellCheck={false}
        className="mt-2 w-full bg-pane-bg px-2 py-1 font-mono text-sm outline-none ring-1 ring-pane-border focus:ring-focus-accent"
      />
      <p id={moduleNameHintId} className="mt-2 text-xs text-text-muted">
        Use it to group a related set of stories. It does not need to match the
        folder name.
      </p>
      <div className="mt-3" data-coach-anchor="module-folder">
        <label
          htmlFor={moduleFolderId}
          className="mb-2 block text-xs font-bold uppercase tracking-wider text-text-secondary"
        >
          Project working directory (CWD)
        </label>
        <ModuleFolderSelection
          selection={folderSelection}
          inputId={moduleFolderId}
          ariaLabel="Module folder"
          ariaDescribedBy={`${moduleFolderHintId}${folderError ? ` ${moduleFolderErrorId}` : ""}`}
          ariaInvalid={folderError !== null}
          disabled={busy}
          pickerInline
          placeholder="Path to the project's code"
        />
        <p id={moduleFolderHintId} className="mt-2 text-xs text-text-muted">
          Ticketry starts terminals and coding agents here. Multiple modules can
          use the same folder.
        </p>
      </div>
      {folderError && (
        <div
          id={moduleFolderErrorId}
          className="mt-2 text-sm text-red-400"
          role="alert"
        >
          {folderError}
        </div>
      )}
      {error && (
        <div className="mt-2 text-sm text-red-400" role="alert">
          {error}
        </div>
      )}
  </div>;
}
