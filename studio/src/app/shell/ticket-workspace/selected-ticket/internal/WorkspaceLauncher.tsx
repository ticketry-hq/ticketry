import { useEffect, useRef, useState } from "react";
import type { SessionMeta } from "../../../../../features/agents/terminal";
import { providerListPlaceholder } from "../../../../../features/workflows";
import { loadSelectedTicketTerminal } from "../terminals/selectedTicketTerminalLoader";

// Providers only: this menu launches agent runs, and a session with no
// provider is a shell that never appears here (#667).
const AVAILABLE_AGENTS: NonNullable<SessionMeta["agent"]>[] = [
  "claude",
  "agy",
  "codex",
  "gemini",
];

/** Taskless scratch run intents offered by the scratch launcher menu. */
export type ScratchLaunchMode = "plan" | "instant";

export interface TicketLaunchContext {
  projectId: string;
  moduleId: string | null;
  taskId: string;
  taskKey: string;
  taskName: string;
}

/**
 * The tab strip's `＋ Agent` capability, discriminated by workspace kind
 * (CODIN-1020): a task workspace lists providers directly and launches a
 * task-bound run; a scratch workspace asks for the run mode first and hands
 * mode selection back to its host, which owns module choice and the shared
 * folder → prompt → provider create flow.
 */
export type WorkspaceLauncherContext =
  | ({ kind: "task" } & TicketLaunchContext)
  | {
      kind: "scratch";
      onChooseMode: (mode: ScratchLaunchMode) => void;
    };

export function WorkspaceLauncher({
  bucket,
  launchContext,
  activatedProviders,
  providersLoaded,
  providersFailed,
  onLaunchTaskAgent,
}: {
  bucket: string;
  launchContext: WorkspaceLauncherContext;
  activatedProviders: ReadonlySet<string>;
  providersLoaded: boolean;
  providersFailed: boolean;
  onLaunchTaskAgent: (
    agent: SessionMeta["agent"],
    context: TicketLaunchContext,
  ) => void;
}) {
  const [launchOpen, setLaunchOpen] = useState(false);
  const launchCommittedRef = useRef(false);
  const launchTriggerRef = useRef<HTMLButtonElement>(null);
  const launchMenuRef = useRef<HTMLDivElement>(null);
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
    context: WorkspaceLauncherContext;
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

  const launcherItems: { id: string; label: string }[] =
    launchContext.kind === "scratch"
      ? [
          { id: "plan", label: "Plan" },
          { id: "instant", label: "Instant" },
        ]
      : providersLoaded && !providersFailed
        ? AVAILABLE_AGENTS.filter((agent) => activatedProviders.has(agent)).map(
            (agent) => ({ id: agent, label: agent }),
          )
        : [];
  const launcherNotice =
    launchContext.kind === "scratch" || launcherItems.length > 0
      ? null
      : providerListPlaceholder({
          loaded: providersLoaded,
          failed: providersFailed,
        });

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
    if (opened.context.kind === "scratch") {
      opened.context.onChooseMode(id as ScratchLaunchMode);
      return;
    }
    onLaunchTaskAgent(id as SessionMeta["agent"], opened.context);
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
    <div className="relative">
      <button
        type="button"
        ref={launchTriggerRef}
        onClick={() =>
          setLaunchOpen((open) => {
            if (!open) {
              launchCommittedRef.current = false;
              openLauncherRef.current = {
                identity: launcherIdentity,
                context: launchContext,
              };
            } else {
              openLauncherRef.current = null;
            }
            return !open;
          })
        }
        onPointerEnter={() => void loadSelectedTicketTerminal()}
        onFocus={() => void loadSelectedTicketTerminal()}
        aria-haspopup="menu"
        aria-expanded={launchOpen}
        title={
          launchContext.kind === "scratch"
            ? "Start a new Plan or Instant run"
            : "Start a new agent run for this issue"
        }
        className="flex shrink-0 items-center border border-dashed border-pane-border px-2 py-0.5 text-xs text-text-muted transition-colors hover:border-focus-accent hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-pane-border disabled:hover:text-text-muted"
      >
        ＋ Agent
      </button>
      {launchOpen && (
        <div
          ref={launchMenuRef}
          role="menu"
          aria-label="Launch agent"
          onKeyDown={onLauncherMenuKeyDown}
          className="absolute left-0 top-full z-10 mt-1 flex min-w-[10ch] flex-col border border-pane-border bg-pane-panel py-1 shadow-lg"
        >
          {launcherNotice ? (
            <p className="px-3 py-1 text-xs text-text-muted">
              {launcherNotice}
            </p>
          ) : (
            launcherItems.map((item) => (
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
            ))
          )}
        </div>
      )}
    </div>
  );
}
