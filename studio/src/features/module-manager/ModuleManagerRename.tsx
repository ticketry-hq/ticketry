import { useEffect, useRef } from "react";
import { cancelModuleManagerRename, useManagerRename } from "./useManagerRename";

export function ModuleManagerRename({ moduleId, name, pending, surface = "row", buttonClass }: {
  moduleId: string; name: string; pending: boolean; surface?: "row" | "detail"; buttonClass: string;
}) {
  const rename = useManagerRename(moduleId, name, surface);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (rename.editing) { input.current?.focus(); input.current?.select(); } }, [rename.editing]);
  if (!rename.editing || !rename.edit) return <button type="button" aria-label={"Rename " + name}
    data-module-manager-rename={moduleId} data-rename-surface={surface} disabled={pending}
    onClick={rename.begin} className={buttonClass}>Rename</button>;
  return <form aria-label={"Rename " + rename.edit.originalName} aria-busy={pending}
    onSubmit={(event) => { event.preventDefault(); void rename.submit(); }}
    className="flex max-w-full flex-wrap items-center gap-1">
    <input ref={input} aria-label="Module name" value={rename.edit.draft} disabled={pending}
      onChange={(event) => rename.setDraft(event.target.value)}
      className="w-32 min-w-0 max-w-full border border-pane-border bg-pane-bg px-2 py-1 text-xs text-text-primary outline-none focus:border-focus-accent disabled:opacity-50" />
    <button type="submit" aria-label="Save module name" disabled={pending} className={buttonClass}>{pending ? "Saving…" : "Save"}</button>
    <button type="button" aria-label="Cancel module rename" onClick={cancelModuleManagerRename} className={buttonClass}>Cancel</button>
    {rename.edit.error ? <p role="alert" className="w-full text-xs text-lifecycle-danger">{rename.edit.error} Edit the name and save to retry.</p> : null}
  </form>;
}
