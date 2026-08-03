// Terminal module — the one seam for presenting and launching agent terminal
// sessions (deep-component refactor; mirrors the backend's terminals Session
// module, CODIN-800).
//
// Import from this file, except for the deliberately narrow appNavigation and
// terminal-create entrypoints used by app coordinators. Everything under
// ./internal — the WS client, xterm/WS entry pool, session-store mutation
// internals, and foreground registry — remains implementation.
//
// The interface, by intent:
//   launchSession / launchDocChat  create a run (the spawn verb, separate from display)
//   useTaskSessions / useActiveSession
//                                  the tab-strip queries: a bucket's ordered
//                                  terminal tabs (with lifecycle) + focused tab
//   useTerminalStore               tab/launch mutations and workspace-store
//                                  reads (transitional width — prefer the hooks
//                                  above for queries; treat additions as
//                                  interface changes)

export { LifecycleBadge } from "./LifecycleBadge";
export { Terminal } from "./Terminal";
// The modal bodies (AgentPicker, ModuleFolder, PromptInput) are deliberately
// NOT value re-exported: ModalHost lazy-imports them from their own public
// leaf entrypoints, and a value re-export here would drag their whole UI
// graph into every hub consumer's dev module graph (bundle-barrel-imports).
// Their payload types are erased at compile time and stay for convenience.
export type { Agent, AgentPickerPayload } from "./AgentPicker";
export type { PromptInputPayload } from "./PromptInput";
export {
  highestAttentionState,
  presentLifecycle,
  reduceLifecycle,
} from "./lifecycle";
export type {
  LifecycleEvent,
  LifecycleEventKind,
  LifecycleEventSource,
  LifecyclePresentation,
  LifecycleState,
  LifecycleTone,
} from "./lifecycle";
export type { ModuleFolderPayload } from "./ModuleFolder";

export {
  launchSession,
  launchDocChat,
  useTaskSessions,
  useActiveSession,
  type SessionTab,
} from "./hooks";

// The store hook plus the pure keys/types hosts need to address sessions.
// Deliberately named — the selector library and mutation internals stay in
// ./internal (module tests reach them white-box).
export {
  bucketFor,
  bucketOfMeta,
  docChatKey,
  isScratchBucket,
  scratchBucketId,
  scratchResumableKey,
  useTerminalStore,
  type SessionMeta,
  type SessionStatus,
} from "./internal/sessionStore";
export { useWorkspaceTabsStore } from "./internal/workspaceTabsStore";
export {
  launchAgent,
  launchDocumentAgent,
  attachToRun,
  ackTerminal,
  closeTerminal,
} from "./internal/actions";

// Shared terminal-create launcher (CODIN-839): folder gate → optional prompt →
// required agent → scratch planning launch. Studio create surfaces consume the
// same seam.
export {
  beginTerminalCreate,
  launchScratchPlanning,
  hasInitialPrompt,
} from "./create/launchTerminalCreate";
export type {
  TerminalCreateRequest,
  TerminalCreateFlow,
  ScratchPlanningLaunch,
} from "./create/types";

export type { ResumableTerminalSession } from "../types";

// Foreground arbitration helpers. `<Terminal>` absorbs claim handling, so most
// callers never need these; exported for the shells that reason about
// ownership transfer explicitly (and their tests).
export {
  foregroundKey,
  isStudioEligible,
  resolveOwner,
  useTerminalForegroundStore,
  type ForegroundOwner,
} from "./internal/foregroundStore";
