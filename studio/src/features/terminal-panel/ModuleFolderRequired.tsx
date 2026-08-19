/**
 * What the panel shows instead of a terminal when a module has no usable
 * folder (#667).
 *
 * A shell is refused rather than opened in a fallback directory: unlike an
 * agent, a bare shell cannot explain where it is, so a shell that looks like it
 * is in your repository but is not fails silently and destructively. The remedy
 * is offered right here, through the same folder-selection affordance the rest
 * of Studio uses, so fixing it never leaves the panel.
 */

import { useState } from "react";

import {
  ModuleFolderSelection,
  useModuleFolderSelection,
} from "../agents/terminal/ModuleFolderSelection";
import { setModuleFolder, useConfig } from "../studio/stores/configStore";

const REFUSAL_MESSAGE: Record<string, string> = {
  module_folder_unset: "This module has no folder yet.",
  module_folder_not_absolute:
    "This module's folder is not a complete filesystem path.",
  module_folder_missing: "This module's folder no longer exists.",
  module_folder_not_a_directory: "This module's folder is not a directory.",
  no_profile_selected: "No profile is selected, so no folder is configured.",
};

export function ModuleFolderRequired({
  moduleId,
  reason,
  onLinked,
}: {
  moduleId: string;
  reason: string;
  onLinked: () => void;
}) {
  const { profiles, recentProfileIndex } = useConfig();
  const selection = useModuleFolderSelection({ profiles, recentProfileIndex });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = selection.value.trim();

  async function link(): Promise<void> {
    if (!selection.isValid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await setModuleFolder(moduleId, path);
      onLinked();
    } catch {
      setError("Could not save the module folder. Retry to continue.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="terminal-panel-folder-required"
      data-refusal-reason={reason}
      className="h-full w-full overflow-auto bg-pane-panel p-3 text-sm text-text-primary"
    >
      <p className="mb-2 text-text-muted">
        {REFUSAL_MESSAGE[reason] ?? "This module has no usable folder."} A shell
        opens in the module folder, so none was started.
      </p>
      <ModuleFolderSelection
        selection={selection}
        ariaLabel="Module folder for the terminal panel"
        placeholder="Local folder"
      />
      {error ? (
        <div className="mt-2 text-red-400" role="alert">
          {error}
        </div>
      ) : null}
      <button
        type="button"
        data-testid="terminal-panel-link-folder"
        disabled={busy || !selection.isValid}
        onClick={() => void link()}
        className="mt-3 border border-focus-accent bg-pane-title px-3 py-1 text-focus-accent"
      >
        Use this folder
      </button>
    </div>
  );
}
