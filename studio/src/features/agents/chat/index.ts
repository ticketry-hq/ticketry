// Public Studio seam for first-class structured Chat runs. Process ownership
// remains in the backend; this module exposes only durable tabs and normalized
// transcript presentation.

export {
  closeChatTab,
  deriveTaskChatSessions,
  launchChatSession,
  reopenChatTab,
  selectChatSession,
  useActiveChatSession,
  useTaskChatSessions,
  type ChatSessionTab,
} from "./hooks";
export { usePersistedChatSessions } from "./queries";
export { useChatStore, type ChatSessionState } from "./store";
export type {
  ChatActivity,
  ChatEvent,
  ChatMessage,
  ChatSessionStatus,
  ChatSessionSummary,
  ChatSnapshot,
  ChatTimelineRow,
  CreateChatRunRequest,
} from "./types";
