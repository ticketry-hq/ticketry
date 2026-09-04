import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { useModalStore } from "../../../../../app/modal/modalStore";
import { loadSelectedTicketTerminal } from "../terminals/selectedTicketTerminalLoader";

/** Taskless scratch run intents offered by the scratch launcher menu. */
export type ScratchLaunchMode = "plan" | "instant";

// The inline menu is the scratch launcher and nothing else, so its whole item
// list is these two fixed modes. A task workspace never populates it: the
// trigger hands that kind straight to the shared agent picker, which owns the
// provider allowlist (`AGENTS` in `features/agents/terminal/AgentPicker.tsx`)
// (CODING-1437).
const SCRATCH_LAUNCH_MODES: { id: ScratchLaunchMode; label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "instant", label: "Instant" },
];

export interface TicketLaunchContext {
  projectId: string;
  moduleId: string | null;
  taskId: string;
  taskKey: string;
  taskName: string;
}

export interface ScratchLaunchContext {
  kind: "scratch";
  onChooseMode: (mode: ScratchLaunchMode) => void;
}

/**
 * The tab strip's `＋ Agent` capability, discriminated by workspace kind
 * (CODIN-1020): a task workspace opens the shared agent picker, which lists
 * providers and launches the task-bound run; a scratch workspace asks for the
 * run mode first in an inline menu and hands mode selection back to its host,
 * which owns module choice and the shared folder → prompt → provider create
 * flow.
 */
export type WorkspaceLauncherContext =
  | ({ kind: "task" } & TicketLaunchContext)
  | ScratchLaunchContext;

export function WorkspaceLauncher({
  bucket,
  launchContext,
  triggerRef,
  onTaskAgentLaunched,
}: {
  bucket: string;
  launchContext: WorkspaceLauncherContext;
  triggerRef: React.RefObject<HTMLButtonElement>;
  /**
   * Called once the agent picker has placed a task run in this workspace, so
   * the host can record the launched run as the workspace's restore target
   * (CODING-1436). The picker owns opening the session and activating the
   * terminal surface.
   */
  onTaskAgentLaunched: () => void;
}) {
  const [launchOpen, setLaunchOpen] = useState(false);
  const pushModal = useModalStore((state) => state.pushModal);
  const launchCommittedRef = useRef(false);
  const launchTriggerRef = triggerRef;
  const launchMenuRef = useRef<HTMLDivElement>(null);
  const [launchMenuPosition, setLaunchMenuPosition] = useState<CSSProperties>({});
  const launcherIdentity =
    launchContext.kind === "task"
      ? [
          bucket,
          launchContext.kind,
          launchContext.projectId,
          launchContext.moduleId ?? "",
          launchContext.taskId,
        ].join("\u0000")
      : [bucket, launchContext.kind].join("\u0000");
  const currentLauncherIdentityRef = useRef(launcherIdentity);
  const openLauncherRef = useRef<{
    identity: string;
    context: ScratchLaunchContext;
  } | null>(null);
  currentLauncherIdentityRef.current = launcherIdentity;

  // The launcher menu never survives a workspace-context change: switching
  // bucket or launcher kind must not leave a hidden launch in progress.
  useEffect(() => {
    setLaunchOpen(false);
    launchCommittedRef.current = false;
    openLauncherRef.current = null;
  }, [launcherIdentity]);

  // While open: focus lands on the first menu item, and a pointer press
  // outside the trigger/menu dismisses without consuming the outside action.
  useEffect(() => {
    if (!launchOpen) return;
    launchMenuRef.current
      ?.querySelector<HTMLButtonElement>("[role=menuitem]")
      ?.focus();
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        launchMenuRef.current?.contains(target) ||
        launchTriggerRef.current?.contains(target)
      ) {
        return;
      }
      openLauncherRef.current = null;
      setLaunchOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [launchOpen]);

  useLayoutEffect(() => {
    if (!launchOpen) return;

    const updatePosition = () => {
      const triggerElement = launchTriggerRef.current;
      const trigger = triggerElement?.getBoundingClientRect();
      if (!trigger) return;
      const tabStripBottom =
        triggerElement
          ?.closest<HTMLElement>('[role="tablist"]')
          ?.getBoundingClientRect().bottom ?? trigger.bottom;
      const menu = launchMenuRef.current;
      const viewportGap = 8;
      const menuGap = 4;
      const menuWidth = menu?.offsetWidth ?? 0;
      const menuHeight = menu?.offsetHeight ?? 0;
      const below = Math.max(trigger.bottom, tabStripBottom) + menuGap;
      const fitsBelow = below + menuHeight <= window.innerHeight - viewportGap;

      setLaunchMenuPosition({
        left: Math.max(
          viewportGap,
          Math.min(trigger.left, window.innerWidth - menuWidth - viewportGap),
        ),
        top: fitsBelow
          ? below
          : Math.max(viewportGap, trigger.top - menuHeight - menuGap),
      });
    };

    updatePosition();
    const layoutObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updatePosition);
    const trigger = launchTriggerRef.current;
    const menu = launchMenuRef.current;
    const tabStrip = trigger?.closest('[role="tablist"]');
    if (trigger) layoutObserver?.observe(trigger);
    if (menu) layoutObserver?.observe(menu);
    if (tabStrip) layoutObserver?.observe(tabStrip);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, {
      capture: true,
      passive: true,
    });
    return () => {
      layoutObserver?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [launchOpen]);

  function activateLauncherItem(id: string) {
    if (launchCommittedRef.current) return;
    const opened = openLauncherRef.current;
    if (!opened || opened.identity !== currentLauncherIdentityRef.current) {
      setLaunchOpen(false);
      return;
    }
    launchCommittedRef.current = true;
    openLauncherRef.current = null;
    setLaunchOpen(false);
    opened.context.onChooseMode(id as ScratchLaunchMode);
  }

  function onLauncherMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      openLauncherRef.current = null;
      setLaunchOpen(false);
      launchTriggerRef.current?.focus();
      return;
    }
    const items = Array.from(
      launchMenuRef.current?.querySelectorAll<HTMLButtonElement>(
        "[role=menuitem]",
      ) ?? [],
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (
      (event.key === "Enter" || event.key === " ") &&
      current >= 0
    ) {
      event.preventDefault();
      activateLauncherItem(items[current].dataset.launcherItem ?? "");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(current + 1) % items.length].focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(current - 1 + items.length) % items.length].focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0].focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1].focus();
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        ref={launchTriggerRef}
        onClick={() => {
          if (launchContext.kind === "task") {
            pushModal({
              type: "agent-picker",
              payload: {
                mode: "open",
                projectId: launchContext.projectId,
                taskId: launchContext.taskId,
                ...(launchContext.moduleId
                  ? { moduleId: launchContext.moduleId }
                  : {}),
                onLaunched: onTaskAgentLaunched,
              },
            });
            return;
          }
          const scratchContext: ScratchLaunchContext = launchContext;
          setLaunchOpen((open) => {
            if (!open) {
              launchCommittedRef.current = false;
              openLauncherRef.current = {
                identity: launcherIdentity,
                context: scratchContext,
              };
            } else {
              openLauncherRef.current = null;
            }
            return !open;
          });
        }}
        onPointerEnter={() => void loadSelectedTicketTerminal()}
        onFocus={() => void loadSelectedTicketTerminal()}
        aria-haspopup={launchContext.kind === "task" ? "dialog" : "menu"}
        aria-expanded={launchContext.kind === "scratch" ? launchOpen : undefined}
        title={
          launchContext.kind === "scratch"
            ? "Start a new Plan or Instant conversation"
            : "Start a new agent run for this issue"
        }
        className="flex shrink-0 items-center border border-dashed border-pane-border px-2 py-0.5 text-xs text-text-muted transition-colors hover:border-focus-accent hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-pane-border disabled:hover:text-text-muted"
      >
        ＋ Agent
      </button>
      {launchOpen && createPortal(
        <div
          ref={launchMenuRef}
          role="menu"
          aria-label="Launch agent"
          onKeyDown={onLauncherMenuKeyDown}
          style={launchMenuPosition}
          className="fixed z-50 flex min-w-[10ch] flex-col border border-pane-border bg-pane-panel py-1 shadow-lg"
        >
          {SCRATCH_LAUNCH_MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              data-launcher-item={item.id}
              onClick={() => activateLauncherItem(item.id)}
              className="px-3 py-1 text-left text-xs font-medium text-text-muted hover:bg-pane-title hover:text-text-primary"
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
