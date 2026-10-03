import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { PlanningWorkItem } from "../../planning-graph";
import { carriesStory, droppedStoryId, endStoryDrag, startStoryDrag } from "../../../shared/dragDrop/storyDrag";

// One side of the Plan screen: a titled list that accepts dropped stories.
export function PlanPane({
  title,
  testId,
  onDropStory,
  children,
}: {
  title: string;
  testId: string;
  onDropStory: (id: string) => void;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <section
      data-testid={testId}
      onDragOver={(event) => {
        if (!carriesStory(event)) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        const id = droppedStoryId(event);
        if (id) { event.preventDefault(); onDropStory(id); }
      }}
      className={`flex min-h-0 flex-col border bg-pane-panel ${over ? "border-focus-accent" : "border-pane-border"}`}
    >
      <h2 tabIndex={-1} className="border-b border-pane-border px-3 py-2 text-base font-semibold text-text-primary outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-accent">{title}</h2>
      <div className="flex-1 overflow-auto py-1">{children}</div>
    </section>
  );
}

export function PlanGroupHeading({ name }: { name: string }) {
  return <div className="px-3 pb-0.5 pt-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">{name}</div>;
}

// A draggable story row with a +/− button, so moving never needs a drag.
// While its write is pending the row neither drags nor moves. A keyboard
// move unmounts the row, so focus goes to the next row's move button in the
// pane, else the previous one, else the pane heading.
export function PlanRow({
  item,
  sign,
  pending,
  selected = false,
  onOpen,
  onMove,
}: {
  item: PlanningWorkItem;
  sign: "+" | "−";
  pending: boolean;
  selected?: boolean;
  onOpen: (id: string) => void;
  onMove: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const refocus = useRef<HTMLElement | null>(null);
  // Runs before React removes the button, while it still holds focus.
  useLayoutEffect(() => () => {
    if (document.activeElement === button.current) refocus.current?.focus();
  }, []);
  return (
    <div
      draggable={!pending}
      aria-busy={pending}
      onDragStart={(event) => startStoryDrag(event, item.id)}
      onKeyDown={(event) => {
        if (event.altKey && event.key === (sign === "+" ? "ArrowDown" : "ArrowUp") && !pending) {
          event.preventDefault();
          refocus.current = moveFocusTarget(button.current);
          onMove();
        }
      }}
      onDragEnd={endStoryDrag}
      data-testid={`plan-item-${item.key}`}
      className={`flex cursor-grab items-center gap-2 px-3 py-1 hover:bg-pane-title active:cursor-grabbing ${selected ? "bg-pane-title" : ""}`}
    >
      <button
        type="button"
        aria-label={sign === "+" ? `Plan ${item.key} into sprint` : `Return ${item.key} to backlog`}
        data-testid={`plan-move-${item.key}`}
        ref={button}
        disabled={pending}
        onClick={(event) => {
          // detail is 0 for Enter/Space; mouse moves keep focus alone.
          refocus.current = event.detail === 0 ? moveFocusTarget(event.currentTarget) : null;
          onMove();
        }}
        className="h-6 w-6 flex-none border border-pane-border text-sm text-text-secondary hover:border-focus-accent hover:text-text-primary disabled:opacity-40"
      >
        {sign}
      </button>
      <button type="button" onClick={() => onOpen(item.id)} className="flex min-w-0 flex-1 gap-3 text-left">
        <span className="w-24 flex-none truncate text-xs text-focus-accent">{item.key}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{item.name}</span>
      </button>
    </div>
  );
}

function moveFocusTarget(from: HTMLElement | null): HTMLElement | null {
  if (!from) return null;
  const pane = from.closest("section");
  const buttons = [...(pane?.querySelectorAll<HTMLButtonElement>('[data-testid^="plan-move-"]') ?? [])];
  const at = buttons.findIndex((button) => button === from);
  const usable = (b?: HTMLButtonElement) => b && !b.disabled;
  return buttons.slice(at + 1).find(usable) ?? buttons.slice(0, at).reverse().find(usable) ?? pane?.querySelector("h2") ?? null;
}

export function PlanEmpty({ children }: { children: ReactNode }) {
  return <div className="px-3 py-2 text-sm text-text-muted">{children}</div>;
}
