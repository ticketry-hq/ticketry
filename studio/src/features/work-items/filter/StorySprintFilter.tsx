import { useId, useEffect, useRef, useState } from "react";
import { useStorySprintHistory } from "../../sprints";
import { useStorySprintFilter } from "./StorySprintFilterController";
import { SprintChoicePopover, type BasicSprintChoice } from "./SprintChoicePopover";
import { ROADMAP_ENABLED } from "../../../shared/config/roadmapAvailability";

interface StorySprintFilterProps {
  matchingRootCount: number;
  totalRootCount: number;
  storiesLoading?: boolean;
}

export function StorySprintFilter(props: StorySprintFilterProps) {
  return ROADMAP_ENABLED ? <AvailableStorySprintFilter {...props} /> : null;
}

function AvailableStorySprintFilter({ matchingRootCount, totalRootCount, storiesLoading = false }: StorySprintFilterProps) {
  const filter = useStorySprintFilter();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<"Planned" | "Completed" | null>("Planned");
  const [search, setSearch] = useState("");
  const [nameQuery, setNameQuery] = useState("");
  const [initialFocus, setInitialFocus] = useState<"search" | "selected">("search");
  const history = useStorySprintHistory(filter.projectId, nameQuery, open);
  useEffect(() => {
    const trimmed = search.trim();
    if (!trimmed) { setNameQuery(""); return; }
    const timer = window.setTimeout(() => setNameQuery(trimmed), 200);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => { setSearch(""); setNameQuery(""); setExpanded("Planned"); }, [filter.projectId]);
  function changeSearch(value: string) { setSearch(value); if (!value.trim()) setNameQuery(""); }
  const trigger = useRef<HTMLButtonElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const id = useId();
  const sprint = filter.intent.mode === "id" ? filter.selectedSprint : filter.activeSprint;
  const label = filter.intent.mode === "none" ? "No sprint"
    : filter.intent.mode === "all" || filter.selection?.mode === "all" ? "All sprints"
    : sprint?.name ?? (filter.intent.mode === "active" ? "Active sprint" : "Selected sprint");
  const status = sprint && filter.selection?.mode === "id" ? sprint.status : undefined;
  const choices: BasicSprintChoice[] = [
    { label: "All sprints", intent: { mode: "all" }, selected: filter.intent.mode === "all", count: filter.complete ? filter.roots.length : undefined },
    { label: "No sprint", intent: { mode: "none" }, selected: filter.intent.mode === "none", count: filter.complete ? filter.roots.filter((root) => root.sprint_id === null).length : undefined },
    { label: filter.activeSprint?.name ?? "Active sprint", status: "Active", intent: { mode: "active" }, selected: filter.intent.mode === "active", count: filter.complete && filter.activeSprint ? filter.roots.filter((root) => root.sprint_id === filter.activeSprint!.id).length : undefined },
  ];
  function historyChoices(collection: typeof history.planned): BasicSprintChoice[] {
    return collection.sprints.map((sprint) => ({ label: sprint.name,
      status: sprint.status, intent: { mode: "id", sprintId: sprint.id },
      selected: filter.intent.mode === "id" && filter.intent.sprintId === sprint.id,
      count: filter.complete ? filter.roots.filter((root) => root.sprint_id === sprint.id).length : undefined }));
  }
  function show(focus: "search" | "selected" = "search") { setInitialFocus(focus); filter.retry(); setOpen(true); }
  function close(returnFocus = false) { setOpen(false); if (returnFocus) trigger.current?.focus(); }
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) close(); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div ref={container} data-story-sprint-picker className="relative mb-2 min-w-0">
    <div className="flex min-w-0 border border-pane-border bg-pane-title/50">
      <button ref={trigger} type="button" aria-label={`Sprint: ${label}${status ? `, ${status[0]!.toUpperCase()}${status.slice(1)}` : ""}`}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => open ? close() : show()} onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
            event.preventDefault(); event.stopPropagation(); show(event.key.startsWith("Arrow") ? "selected" : "search");
          }
        }} className="flex min-h-8 max-[400px]:min-h-10 min-w-0 flex-1 items-center gap-2 px-2 text-xs text-text-primary focus:outline focus:outline-1 focus:outline-focus-accent">
        <span className="text-text-muted">Sprint</span><span className="min-w-0 flex-1 truncate text-left" title={label}>{label}</span>
        {status ? <span className="text-[10px] capitalize text-text-muted">{status}</span> : null}<span aria-hidden>⌄</span>
      </button>
      {filter.intent.mode !== "all" ? <button type="button" aria-label="Show all sprints" onClick={() => filter.setIntent({ mode: "all" })}
        className="w-7 shrink-0 text-text-muted hover:text-text-primary focus:outline focus:outline-1 focus:outline-focus-accent">×</button> : null}
    </div>
    {open ? <SprintChoicePopover id={id} choices={choices} onClose={close}
      planned={{ collection: history.planned, choices: historyChoices(history.planned) }}
      completed={{ collection: history.completed, choices: historyChoices(history.completed) }}
      expanded={expanded} onExpand={setExpanded}
      search={search} scope={`${filter.projectId}:${nameQuery}`} onSearchChange={changeSearch} initialFocus={initialFocus}
      onChoose={(intent) => { filter.setIntent(intent); close(true); }} /> : null}
    <p role="status" aria-live="polite" className="mt-1 text-[10px] text-text-muted">
      {filter.status === "loading" || storiesLoading ? "Loading sprint stories…" : filter.status === "error" ? "Sprint results unavailable" : `${matchingRootCount} of ${totalRootCount} stories`}
    </p>
    {filter.status === "error" ? <div className="mt-1 text-xs text-text-muted" role="status">
      Sprint filter unavailable. <button type="button" onClick={filter.retry} className="underline focus:outline focus:outline-1 focus:outline-focus-accent">Retry</button>
    </div> : null}
    {filter.notice ? <p role="status" className="mt-1 text-xs text-text-muted">{filter.notice}</p> : null}
  </div>;
}
