import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import type {
  DesignDoc,
  ResumableTerminalSession,
} from "../../../../../features/agents/types";
import {
  providerTextClass,
  type DormantTerminalChip,
} from "../../../../../features/agents/terminal";

// Everything this workspace is not currently looking at — documents you
// closed, conversations you can resume, and terminated runs kept as history —
// folds into one "↻ Resume" dropdown pinned to the tab strip's right end, so
// dormant state never costs the workspace a second chrome row.
//
// The terminal rows speak the tab strip's vocabulary (#695) — the phase the
// conversation began in, the provider in colour, the recorded launch facts on
// hover — because they are the same runs.
//
// The menu is portalled and `role="menu"` so native terminal views yield to it
// (useNativeWebViewSiblingInteraction). It stays open while a resume runs so
// the "Resuming…" row, and any second concurrent resume, remain reachable.

const itemClassName =
  "flex w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-pane-title disabled:cursor-wait disabled:opacity-50";
const sectionClassName =
  "px-3 pb-0.5 pt-1.5 text-[10px] uppercase tracking-wider text-text-muted";

export function DormantWorkspaceTabs({
  closedDocuments,
  resumableChips,
  historyChips,
  resumableSessions,
  resumingRunIds,
  onReopenDocument,
  onResumeTerminal,
}: {
  closedDocuments: readonly DesignDoc[];
  resumableChips: readonly DormantTerminalChip[];
  historyChips: readonly DormantTerminalChip[];
  resumableSessions: readonly ResumableTerminalSession[];
  resumingRunIds: ReadonlySet<string>;
  onReopenDocument: (docId: string) => void;
  onResumeTerminal: (session: ResumableTerminalSession) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const resumable = resumableChips.flatMap((chip) => {
    const session = resumableSessions.find(
      (candidate) => candidate.agent_run_id === chip.key,
    );
    return session ? [{ chip, session }] : [];
  });
  const count = closedDocuments.length + resumable.length + historyChips.length;
  const empty = count === 0;

  useEffect(() => {
    if (empty) setOpen(false);
  }, [empty]);

  useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")
      ?.focus();
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        menuRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Right-aligned under the tab strip, tracking layout while open.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const trigger = triggerRef.current;
      const rect = trigger?.getBoundingClientRect();
      if (!rect) return;
      const stripBottom =
        trigger
          ?.closest<HTMLElement>('[role="tablist"]')
          ?.getBoundingClientRect().bottom ?? rect.bottom;
      setPosition({
        top: Math.max(rect.bottom, stripBottom) + 4,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  if (empty) return null;

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        "[role=menuitem]:not(:disabled)",
      ) ?? [],
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const step =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    items[(current + step + items.length) % items.length].focus();
  }

  const resumingCount = resumable.filter(({ chip }) =>
    resumingRunIds.has(chip.key),
  ).length;

  return (
    <div className="ml-1 flex shrink-0 items-center">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Dormant tabs (${count})`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Resume a conversation or reopen a closed document"
        data-testid="dormant-tabs-trigger"
        onClick={() => setOpen((value) => !value)}
        className={`flex shrink-0 items-center gap-1.5 border px-2 py-0.5 text-xs transition-colors hover:border-focus-accent hover:text-text-primary ${
          open
            ? "border-focus-accent text-text-primary"
            : "border-dashed border-pane-border text-text-muted"
        }`}
      >
        <span>{resumingCount > 0 ? "↻ Resuming…" : "↻ Resume"}</span>
        <span className="bg-pane-title px-1.5 text-[10px] text-text-primary">
          {count}
        </span>
        <span aria-hidden className="text-[10px]">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Dormant tabs"
            onKeyDown={onMenuKeyDown}
            style={position}
            className="fixed z-50 flex max-h-[60vh] min-w-[240px] max-w-[380px] flex-col overflow-y-auto border border-pane-border bg-pane-panel py-1 shadow-lg"
          >
            {resumable.length > 0 && (
              <div role="presentation" className={sectionClassName}>
                Resume conversation
              </div>
            )}
            {resumable.map(({ chip, session }) => {
              const resuming = resumingRunIds.has(chip.key);
              return (
                <button
                  key={chip.key}
                  type="button"
                  role="menuitem"
                  aria-label={`Resume ${chip.accessibleName}`}
                  title={chip.hoverTitle || undefined}
                  disabled={resuming}
                  onClick={() => onResumeTerminal(session)}
                  className={`${itemClassName} ${providerTextClass(chip)}`}
                >
                  {resuming ? "Resuming…" : `↻ ${chip.label}`}
                </button>
              );
            })}
            {closedDocuments.length > 0 && (
              <div role="presentation" className={sectionClassName}>
                Reopen document
              </div>
            )}
            {closedDocuments.map((document) => (
              <button
                key={document.id}
                type="button"
                role="menuitem"
                aria-label={`Reopen ${document.label}`}
                onClick={() => {
                  setOpen(false);
                  onReopenDocument(document.id);
                }}
                className={`${itemClassName} text-text-muted hover:text-text-primary`}
              >
                + {document.label}
              </button>
            ))}
            {historyChips.length > 0 && (
              <div role="presentation" className={sectionClassName}>
                Terminated
              </div>
            )}
            {historyChips.map((chip) => (
              <span
                key={chip.key}
                role="menuitem"
                aria-disabled="true"
                // Assistive text has no colour to read the provider from, so
                // the row names it the same way a tab's accessible name does.
                aria-label={`Terminated ${chip.accessibleName}`}
                title={chip.hoverTitle || "Terminated run"}
                className={`flex items-center gap-2 px-3 py-1 text-xs opacity-60 ${providerTextClass(chip)}`}
              >
                {chip.label} ✕
              </span>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
