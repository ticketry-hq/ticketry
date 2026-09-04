import { useEffect, useRef, type RefObject } from "react";
import { isTypingTarget } from "../../../../../shared/utilities/keyboard";
import { useClientStore } from "../../../../../state/clientStore";
import type { WorkspaceTabIdentity } from "../../../../../features/workspace-tabs/types";

export type TaskWorkspaceTabIdentity = WorkspaceTabIdentity;

function sameTab(
  left: TaskWorkspaceTabIdentity,
  right: TaskWorkspaceTabIdentity,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "details" || left.kind === "changes") return true;
  if (right.kind === "details" || right.kind === "changes") return false;
  return left.id === right.id;
}

function isXtermInput(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest(".xterm") !== null;
}

type MountedWorkspaceEntry = {
  /** False while the pane renders no tab strip (no bucket selected). */
  navigable: boolean;
  /** Applies one accepted keydown to this workspace's tab sequence. */
  navigate: (
    event: KeyboardEvent,
    actionId: WorkspaceTabActionId,
  ) => void;
  editViewAction: (
    event: KeyboardEvent,
    actionId: EditViewWorkspaceActionId,
  ) => EditViewWorkspaceActionOutcome;
  /** A drawer workspace owns the axis modally while it is mounted. */
  modal: boolean;
};

const mountedWorkspaces = new Set<MountedWorkspaceEntry>();
export type WorkspaceTabActionId =
  | "workspace-tab-next"
  | "workspace-tab-previous";
export type EditViewWorkspaceActionId =
  | "highlight-next"
  | "highlight-previous"
  | "dive-active"
  | "commit-highlight"
  | "engage-active";
export type EditViewWorkspaceActionOutcome =
  | "acted"
  | "clamped"
  | "unavailable";

export function routeTaskWorkspaceEditViewAction(
  event: KeyboardEvent,
  actionId: EditViewWorkspaceActionId,
): EditViewWorkspaceActionOutcome {
  const owner = [...mountedWorkspaces].find(
    (entry) => !entry.modal && entry.navigable,
  );
  event.preventDefault();
  event.stopImmediatePropagation();
  return owner?.editViewAction(event, actionId) ?? "unavailable";
}

export function routeTaskWorkspaceTabAction(
  event: KeyboardEvent,
  actionId: WorkspaceTabActionId,
): boolean {
  if (isTypingTarget(event.target) && !isXtermInput(event.target)) return false;

  const modalEntries = [...mountedWorkspaces].filter((entry) => entry.modal);
  if (modalEntries.length > 0) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const owner = modalEntries.find((entry) => entry.navigable);
    owner?.navigate(event, actionId);
    return true;
  }

  const ui = useClientStore.getState();
  if (ui.sidebarVisible && ui.focusedPane !== "details-or-terminal") return false;
  const owner = [...mountedWorkspaces].find(
    (entry) => !entry.modal && entry.navigable,
  );
  if (!owner) return false;
  owner.navigate(event, actionId);
  return true;
}

/**
 * Exact Command-arrow navigation for one mounted task workspace, arbitrated
 * across every mounted workspace: the caller owns one rendered Details →
 * documents → terminals sequence, and the shared arbiter above guarantees a
 * single accepted event advances at most one workspace.
 */
export function useTaskWorkspaceTabNavigation({
  tabs,
  activeTab,
  highlightedTab,
  highlightTab,
  selectTab,
  diveTab,
  engageTab,
  launcherTriggerRef,
  onBeforeFirst,
  modal = false,
}: {
  tabs: readonly TaskWorkspaceTabIdentity[];
  activeTab: TaskWorkspaceTabIdentity;
  highlightedTab: TaskWorkspaceTabIdentity;
  highlightTab: (tab: TaskWorkspaceTabIdentity) => void;
  selectTab: (tab: TaskWorkspaceTabIdentity) => void;
  diveTab: (tab: TaskWorkspaceTabIdentity, activate: boolean) => void;
  engageTab: (tab: TaskWorkspaceTabIdentity) => void;
  launcherTriggerRef: RefObject<HTMLButtonElement>;
  /** Continue a host's horizontal axis left of the pinned Details tab. */
  onBeforeFirst?: () => void;
  /** Mounted overlay workspaces take modal ownership ahead of background hosts. */
  modal?: boolean;
}): void {
  const entryRef = useRef<MountedWorkspaceEntry | null>(null);
  entryRef.current ??= {
    navigable: false,
    navigate: () => {},
    editViewAction: () => "unavailable",
    modal: false,
  };
  const entry = entryRef.current;

  useEffect(() => {
    mountedWorkspaces.add(entry);
    return () => {
      mountedWorkspaces.delete(entry);
    };
  }, [entry]);

  // Keep the registered entry in lockstep with the latest render.
  useEffect(() => {
    entry.navigable = tabs.length > 0;
    entry.modal = modal;
    entry.editViewAction = (
      event: KeyboardEvent,
      actionId: EditViewWorkspaceActionId,
    ) => {
      if (tabs.length === 0) return "unavailable";
      event.preventDefault();
      event.stopImmediatePropagation();

      if (actionId === "dive-active") {
        diveTab(activeTab, false);
        return "acted";
      }
      if (actionId === "commit-highlight") {
        if (document.activeElement === launcherTriggerRef.current) {
          launcherTriggerRef.current?.click();
          return "acted";
        }
        diveTab(highlightedTab, true);
        return "acted";
      }
      if (actionId === "engage-active") {
        engageTab(activeTab);
        return "acted";
      }

      const launcher = launcherTriggerRef.current;
      if (
        actionId === "highlight-previous" &&
        launcher &&
        document.activeElement === launcher
      ) {
        highlightTab(tabs[tabs.length - 1]);
        launcher.closest<HTMLElement>('[role="tablist"]')?.focus({
          preventScroll: true,
        });
        return "acted";
      }
      const currentIndex = Math.max(
        0,
        tabs.findIndex((tab) => sameTab(tab, highlightedTab)),
      );
      const delta = actionId === "highlight-next" ? 1 : -1;
      if (
        delta > 0 &&
        currentIndex === tabs.length - 1 &&
        launcher
      ) {
        launcher.focus({ preventScroll: true });
        return "acted";
      }
      const nextIndex = Math.min(
        tabs.length - 1,
        Math.max(0, currentIndex + delta),
      );
      if (nextIndex === currentIndex) return "clamped";
      highlightTab(tabs[nextIndex]);
      return "acted";
    };
    entry.navigate = (event: KeyboardEvent, actionId: WorkspaceTabActionId) => {
      if (tabs.length === 0) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const currentIndex = Math.max(
        0,
        tabs.findIndex((tab) => sameTab(tab, activeTab)),
      );
      const delta = actionId === "workspace-tab-next" ? 1 : -1;
      if (delta < 0 && currentIndex === 0 && onBeforeFirst) {
        onBeforeFirst();
        return;
      }
      const nextIndex = Math.min(
        tabs.length - 1,
        Math.max(0, currentIndex + delta),
      );
      if (nextIndex !== currentIndex) selectTab(tabs[nextIndex]);
    };
  });
}
