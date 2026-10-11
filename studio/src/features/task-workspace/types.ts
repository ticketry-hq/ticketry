import type { ReactNode } from "react";
import type { ForegroundOwner } from "../agents/terminal";

/** Taskless scratch run intents offered by the scratch launcher menu. */
export type ScratchLaunchMode = "plan" | "instant";

export interface TicketLaunchContext {
  projectId: string;
  moduleId: string | null;
  taskId: string;
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

/** Host identity, presentation authority, and entry intent for a retained workspace. */
export interface TaskWorkspaceProps {
  bucket: string | null;
  projectId: string | null;
  moduleId: string | null;
  owner: ForegroundOwner;
  /** Whether this host may present and focus its retained workspace. Defaults to true. */
  workspaceActive?: boolean;
  details: ReactNode;
  launchContext?: WorkspaceLauncherContext | null;
  /** A nonzero Details-entry signal, preserving the existing host entry behavior. */
  entrySignal?: number;
  onBeforeFirstTab?: () => void;
  /** True only for an issue-drawer workspace. Defaults to false. */
  modal?: boolean;
  /** Restricts a Conversations row to its existing run. */
  conversationRunId?: string | null;
  conversationTitle?: string | null;
}
