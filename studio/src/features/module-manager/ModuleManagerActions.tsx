import type { ModuleTabEntry } from "../module-tabs";
import type { ModuleManagerAction } from "./useManagerActions";
import { ModuleManagerRename } from "./ModuleManagerRename";

export function ModuleManagerActions({ entry, loading, pending, onAction, surface = "row" }: {
  entry: ModuleTabEntry; loading: boolean; pending: boolean;
  onAction: (moduleId: string, action: ModuleManagerAction) => void;
  surface?: "row" | "detail";
}) {
  if (entry.status === "archived") return <span className="text-xs text-text-muted">Inspection only</span>;
  const hidden = entry.status === "hidden";
  const clearsFilter = entry.sprintEligible === false;
  const actionClass = "px-2 py-1 text-xs text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-accent disabled:opacity-40";
  const buttonClass = actionClass + " hover:bg-pane-title hover:text-text-primary";
  return <div className="flex min-w-0 max-w-full shrink flex-col items-end gap-0.5">
    <div className="flex max-w-full flex-wrap items-center justify-end">
      {hidden || entry.status === "not-in-sprint" ? <button type="button" aria-label={"Restore " + entry.module.name} disabled={loading || pending}
        onClick={() => onAction(entry.module.id, "restore")} className={buttonClass}>Restore</button>
        : null}
      {!hidden ? <button type="button" aria-label={"Open " + entry.module.name} disabled={loading || pending}
          onClick={() => onAction(entry.module.id, "open")} className={buttonClass}>Open</button> : null}
      {entry.status === "open" ? <button type="button" aria-label={"Close " + entry.module.name + " tab"} disabled={pending || loading}
        onClick={() => onAction(entry.module.id, "close")} className={buttonClass}>Close tab</button> : null}
    <ModuleManagerRename moduleId={entry.module.id} name={entry.module.name} pending={pending} surface={surface} buttonClass={buttonClass} />
    <button type="button" aria-label={"Archive " + entry.module.name} disabled={pending}
      onClick={() => onAction(entry.module.id, "archive")}
      className={actionClass + " hover:bg-lifecycle-danger/10 hover:text-lifecycle-danger"}>Archive</button>
    </div>
    {clearsFilter ? <span className="text-[11px] text-text-muted">Clears sprint filter to show all modules</span> : null}
  </div>;
}
