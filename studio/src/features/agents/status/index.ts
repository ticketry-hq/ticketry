export {
  isLiveAgentRunState,
  MODULE_LIFECYCLE_STATES,
  selectModuleLifecycleCounts,
  selectRunState,
  selectScratchLifecycleChips,
  selectScratchRunIds,
  selectTaskAgentLifecycle,
  selectTaskAutomationAttempts,
  selectTaskLifecycleChips,
  selectTaskRunCount,
  toAgentLifecycle,
} from "./selectors";
export type {
  ModuleLifecycleCounts,
  ModuleLifecycleState,
  TaskLifecycleChip,
} from "./selectors";
export { isAgentlessRun, SHELL_RUN_SCOPE } from "./runScopes";
export { useAgentStatusStore } from "./store";
export type { AgentStatusStore } from "./store";
export {
  projectRunPresentation,
  stallDeadlineAt,
  STALL_AFTER_MS,
} from "./runPresentation";
export { startStallDeadlines, stopStallDeadlines } from "./stallDeadlines";
// statusFeed (live-feed wiring: SDK client, retry service, store fan-out) and
// retryAutomationAttempt are NOT re-exported: most hub consumers only need
// selectors/store, and re-exporting the feed would pull its whole dependency
// graph into their dev module graphs (bundle-barrel-imports). The app shell
// imports ./statusFeed directly; lifecycle imports ./retryAutomationAttempt.
export type {
  AgentLifecycle,
  AgentRunScope,
  AgentStatusData,
  AgentStatusScope,
  AutomationAttemptRecord,
  RawLifecycleState,
  RunPresentationState,
  RunRecord,
} from "./types";
