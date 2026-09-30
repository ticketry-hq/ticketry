import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

import { compactWorktrackerId } from "../../../../shared/api/generatedWorktracker";
import { resolveCaptureKeymapAction } from "../../../../shared/navigation/keymapResolver";
import {
  CHANGES_CHECKOUT_ACTIONS,
  type ChangesCheckoutAction,
} from "./changesKeyboardNavigation";
import { checkoutToneClass } from "./worktreeCheckoutRows";
import { useWorktreeCheckouts } from "./useWorktreeCheckouts";

/**
 * Pick which checkout the Changes surface is reviewing.
 *
 * This replaced a permanent column that only ever repeated the tab strip. As a
 * switcher it costs one row of the toolbar, and it can afford to carry the
 * state each checkout is in, which the column never did. It is a hand-rolled
 * listbox rather than the shared Popover because the options own arrow, Home,
 * End, Enter and Escape through the Changes keymap and return focus to the
 * trigger, which the generic popover does not do.
 */
export function WorktreeSwitcher({ moduleId, selectedTaskId, onOpenModule, onOpenTask }: {
  moduleId?: string | null;
  selectedTaskId: string | null;
  onOpenModule: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const { rows, loading, failed, truncated } = useWorktreeCheckouts(moduleId);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const ownsFocusRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const rowId = (taskId: string | null) => taskId === null ? "module" : compactWorktrackerId(taskId);
  const isSelected = (taskId: string | null) => taskId === null
    ? selectedTaskId === null
    : compactWorktrackerId(taskId) === compactWorktrackerId(selectedTaskId ?? "");
  const selectedIndex = Math.max(0, rows.findIndex((row) => isSelected(row.taskId)));
  const current = rows[selectedIndex];
  const taskRows = rows.filter((row) => row.taskId !== null);
  const rowIds = rows.map((row) => rowId(row.taskId)).join("\u0000");
  useEffect(() => {
    const frame = requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [selectedTaskId]);
  const close = (restore = true) => {
    setOpen(false);
    if (restore) requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  };
  const show = () => {
    const id = current ? rowId(current.taskId) : null;
    setOpen(true);
    setActiveId(id);
    requestAnimationFrame(() => id && optionRefs.current.get(id)?.focus({ preventScroll: true }));
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);
  const optionKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const action = resolveCaptureKeymapAction(
      event.nativeEvent,
      CHANGES_CHECKOUT_ACTIONS,
    ) as ChangesCheckoutAction | null;
    if (!action) return;
    event.preventDefault(); event.stopPropagation();
    if (action === "changes.checkout.cancel") { close(); return; }
    if (action === "changes.checkout.select") { event.currentTarget.click(); return; }
    const next = action === "changes.checkout.first" ? 0
      : action === "changes.checkout.last" ? rows.length - 1
        : action === "changes.checkout.next" ? Math.min(rows.length - 1, index + 1)
          : Math.max(0, index - 1);
    const nextRow = rows[next];
    if (!nextRow) return;
    const id = rowId(nextRow.taskId);
    setActiveId(id);
    optionRefs.current.get(id)?.focus({ preventScroll: true });
  };
  const triggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const action = resolveCaptureKeymapAction(
      event.nativeEvent,
      CHANGES_CHECKOUT_ACTIONS,
    ) as ChangesCheckoutAction | null;
    if (action !== "changes.checkout.select") return;
    event.preventDefault();
    event.stopPropagation();
    if (open) close(false);
    else show();
  };
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget !== null && !rootRef.current?.contains(event.relatedTarget as Node)) {
      ownsFocusRef.current = false;
      setOpen(false);
    }
  };
  useEffect(() => {
    if (!open) return;
    if (activeId && rows.some((row) => rowId(row.taskId) === activeId)) return;
    const fallback = rows.find((row) => isSelected(row.taskId)) ?? rows[0];
    if (!fallback) return;
    const id = rowId(fallback.taskId);
    setActiveId(id);
    if (ownsFocusRef.current) requestAnimationFrame(() => optionRefs.current.get(id)?.focus({ preventScroll: true }));
  }, [activeId, open, rowIds]);
  return (
    <div
      ref={rootRef}
      className="relative"
      data-testid="changes-worktree-switcher"
      onFocusCapture={() => { ownsFocusRef.current = true; }}
      onBlur={handleBlur}
    >
      <button ref={triggerRef} type="button" onClick={() => open ? close(false) : show()} onKeyDown={triggerKey} aria-expanded={open} aria-haspopup="listbox" aria-label="Choose checkout" className="flex min-w-0 max-w-[26rem] items-center gap-2 border border-pane-border px-2 py-1 text-left hover:bg-pane-title focus-visible:ring-1 focus-visible:ring-focus-accent">
        {current ? <span aria-hidden="true" className={`size-2 shrink-0 ${checkoutToneClass(current.tone)}`} /> : null}
        <span className="truncate font-medium text-text-primary">{current?.label ?? (moduleId ? "Loading checkouts..." : "Worktree checkouts unavailable")}</span>
        {current?.branch ? <span className="truncate font-mono text-xs text-text-muted">{current.branch}</span> : null}
        <span aria-hidden="true" className="text-text-muted">▾</span>
      </button>
      {open ? (
        <section aria-label="Worktree checkouts" className="absolute left-0 top-full z-50 mt-1 min-w-[22rem] border border-pane-border bg-pane-panel shadow-2xl">
          <header className="px-3 py-1.5">
            <h2 className="text-xs uppercase tracking-wide text-text-secondary">Current worktrees</h2>
            <p className="text-xs text-text-muted">Module checkout first, then active task worktrees.</p>
          </header>
          <ul role="listbox" aria-label="Current worktree checkouts" className="max-h-[22rem] overflow-y-auto">
            {rows.map((row, index) => {
              const id = rowId(row.taskId);
              const selected = isSelected(row.taskId);
              return <li key={id}>
              <button
                ref={(node) => { if (node) optionRefs.current.set(id, node); else optionRefs.current.delete(id); }}
                type="button"
                role="option"
                aria-selected={selected}
                aria-label={`Open ${row.label} Changes`}
                onFocus={() => setActiveId(id)}
                onKeyDown={(event) => optionKey(event, index)}
                onClick={() => {
                  close(true);
                  if (row.taskId === null) onOpenModule(); else onOpenTask(row.taskId);
                }}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-pane-title focus-visible:ring-1 focus-visible:ring-focus-accent ${selected ? "bg-pane-title shadow-[inset_2px_0_0_0_theme(colors.focus.accent)]" : ""}`}
              >
                <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 ${checkoutToneClass(row.tone)}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-text-primary">{row.label}</span>
                  {row.branch ? <span className="block truncate font-mono text-xs text-text-muted">{row.branch}</span> : null}
                </span>
                {row.summary ? <span className="shrink-0 font-mono text-xs text-text-secondary">{row.summary}</span> : null}
              </button>
            </li>;
            })}
          </ul>
          {failed ? <p role="alert" className="px-3 py-2 text-xs text-lifecycle-danger">Unable to load worktree checkouts.</p>
            : loading ? <p role="status" className="px-3 py-2 text-xs text-text-muted">Loading worktree checkouts...</p>
              : taskRows.length === 0 ? <p className="px-3 py-2 text-xs text-text-muted">No current task worktrees.</p> : null}
          {truncated ? <p role="status" className="px-3 py-2 text-xs text-lifecycle-attention">The current-worktree limit was reached.</p> : null}
        </section>
      ) : null}
    </div>
  );
}
