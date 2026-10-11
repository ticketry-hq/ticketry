import { ModuleManagerMetadata } from "./ModuleManagerMetadata";
import { useModuleInspectionMetadata } from "./useModuleInspectionMetadata";
import type { ReactNode } from "react";
import type { ModuleTabEntry } from "../module-tabs";
import { ModuleLifecycleChicklets } from "../agents/status";
import { ModuleManagerActions } from "./ModuleManagerActions";
import type { ModuleManagerAction } from "./useManagerActions";
import type { DragSourceProps, DropTargetProps, DropIntent } from "../../shared/dragDrop/useAxisDragAndDrop";

export function ModuleManagerRow({ entry, selected, folder, accent, loading, pending, error, onInspect, onAction, inspection, expanded = false, onToggleExpanded, stories, dragSourceProps, dropTargetProps, dropIntent = null }: {
  entry: ModuleTabEntry; selected: boolean; folder?: string; accent?: string | null; loading: boolean;
  pending: boolean; error?: string; onInspect: (id: string) => void;
  onAction: (id: string, action: ModuleManagerAction) => void; inspection?: ReactNode;
  expanded?: boolean; onToggleExpanded?: (id: string) => void; stories?: ReactNode;
  dragSourceProps?: DragSourceProps; dropTargetProps?: DropTargetProps; dropIntent?: DropIntent | null;
}) {
  const { module } = entry;
  const metadata = useModuleInspectionMetadata(module.project_id, module.id);
  return <li data-module-manager-row={module.id} draggable={false} {...dragSourceProps} {...dropTargetProps}
    className={"relative border-b border-pane-border/50 " + (selected ? "bg-selection-bg" : "hover:bg-pane-title/50")}>
    {dropIntent ? <span aria-hidden="true" data-testid="module-manager-drop-seam" data-drop-intent={dropIntent}
      className={"pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-focus-accent " + (dropIntent === "near" ? "top-0" : "bottom-0")} /> : null}
    <div className="flex min-h-10 min-w-0 items-center gap-2 border-l-[3px] px-3 py-1" style={{ borderLeftColor: accent ?? "#7aa2f7" }}>
      {onToggleExpanded ? <button type="button" data-module-manager-expand={module.id} aria-label={(expanded ? "Collapse " : "Expand ") + module.name + " stories"} aria-expanded={expanded} onClick={() => onToggleExpanded(module.id)} className="shrink-0 px-1 text-text-muted focus-visible:outline focus-visible:outline-focus-accent">{expanded ? "▾" : "▸"}</button> : null}
      <button type="button" aria-label={"Inspect " + module.name} aria-pressed={selected} data-module-manager-inspect={module.id}
        onClick={() => onInspect(module.id)}
        className="min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-accent">
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="shrink-0 text-[8px] leading-none text-text-muted">●</span>
          <span className="shrink-0 font-mono text-xs text-text-muted">{module.key}</span>
          <span className="min-w-0 truncate text-[13px] text-text-primary">{module.name}</span>
          <ModuleLifecycleChicklets moduleId={module.id} />
        </span>
        <ModuleManagerMetadata metadata={metadata} folder={folder} />
      </button>
      <ModuleManagerActions entry={entry} loading={loading} pending={pending} onAction={onAction} />
    </div>
    {error ? <p role="alert" className="px-6 pb-2 text-xs text-lifecycle-danger">{error} Use the action again to retry.</p> : null}
    {metadata.error ? <p role="alert" className="px-6 pb-2 text-xs text-lifecycle-danger">{metadata.error}<button type="button" aria-label={"Retry " + module.name + " metadata"} onClick={() => { void metadata.retry(); }} className="ml-2 underline focus-visible:outline focus-visible:outline-focus-accent">Retry</button></p> : null}
    {expanded ? stories : null}
    {selected ? inspection : null}
  </li>;
}
