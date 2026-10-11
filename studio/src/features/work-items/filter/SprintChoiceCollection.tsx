import { useLayoutEffect, useRef, useState } from "react";
import type { StorySprintHistoryCollection } from "../../sprints";
import { SprintChoiceOption, type BasicSprintChoice } from "./SprintChoiceOption";

export function SprintChoiceCollection({ title, expanded, onToggle, collection, choices, onChoose }: {
  title: "Planned" | "Completed";
  expanded: boolean;
  onToggle: () => void;
  collection: StorySprintHistoryCollection;
  choices: BasicSprintChoice[];
  onChoose: (intent: BasicSprintChoice["intent"]) => void;
}) {
  const action = useRef<HTMLButtonElement>(null);
  const actionOwnedFocus = useRef(false);
  const options = useRef<HTMLDivElement>(null);
  const appendFrom = useRef<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  useLayoutEffect(() => {
    if (appendFrom.current === null || choices.length <= appendFrom.current) return;
    const first = appendFrom.current;
    appendFrom.current = null;
    const ownsFocus = document.activeElement === action.current
      || (actionOwnedFocus.current && document.activeElement === document.body);
    if (expanded && ownsFocus) options.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[first]?.focus();
    setAnnouncement(`${choices.length - first} more ${title.toLowerCase()} sprints loaded.`);
  }, [choices.length, title, expanded]);
  useLayoutEffect(() => {
    if (collection.error && actionOwnedFocus.current && document.activeElement === document.body) action.current?.focus();
  }, [collection.error]);
  function load(retry = false) {
    setAnnouncement("");
    actionOwnedFocus.current = document.activeElement === action.current;
    appendFrom.current = choices.length;
    if (retry) collection.retry(); else collection.loadMore();
  }
  const tabStop = focusedIndex !== null && focusedIndex < choices.length ? focusedIndex : Math.max(0, choices.findIndex((choice) => choice.selected));
  const count = collection.total === null ? "Loading…" : `${choices.length} of ${collection.total} sprints`;
  return <section className={`${expanded ? "flex min-h-0 flex-1 flex-col" : "shrink-0"} border-t border-pane-border`}>
    <button type="button" aria-expanded={expanded} onClick={onToggle}
      className="flex w-full shrink-0 items-center justify-between gap-2 px-2 py-2 text-left text-xs text-text-muted focus:outline focus:outline-1 focus:outline-focus-accent">
      <span>{expanded ? "▾" : "▸"} {title}</span><span>{count}</span>
    </button>
    {expanded ? <>
      <div ref={options} role="listbox" aria-label={`${title} sprints`} className="min-h-0 overflow-y-auto overscroll-contain">
        {choices.map((choice, index) => <SprintChoiceOption key={choice.intent.mode === "id" ? choice.intent.sprintId : index}
          choice={choice} onChoose={onChoose} onFocus={() => setFocusedIndex(index)} tabIndex={index === tabStop ? 0 : -1} />)}
        {!choices.length && !collection.loading && !collection.error ? <p className="px-2 py-3 text-xs text-text-muted">No {title.toLowerCase()} sprints.</p> : null}
      </div>
      <div className="shrink-0 px-2 py-1 text-xs text-text-muted">
        {collection.error ? <div role="status">Sprint choices unavailable. <button ref={action} type="button" aria-label={`Retry ${title.toLowerCase()} sprints`}
          onClick={() => load(true)} className="underline focus:outline focus:outline-1 focus:outline-focus-accent">Retry</button></div>
          : collection.loading || collection.hasMore ? <button ref={action} type="button" disabled={collection.loading}
            aria-label={`Load more ${title.toLowerCase()} sprints`} onClick={() => load()}
            className="w-full py-2 text-left focus:outline focus:outline-1 focus:outline-focus-accent disabled:opacity-60">
            {collection.loading ? "Loading…" : "Load more"}</button> : null}
      </div>
    </> : null}
    <span role="status" aria-live="polite" className="sr-only">{announcement}</span>
  </section>;
}
