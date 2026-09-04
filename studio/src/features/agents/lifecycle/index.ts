// Lifecycle module — the agent-state axis (#498) as a droppable unit.
//
// Import ONLY from this file. The interface:
//   <AgentStateBadge issueKey />  the live agent-state chip for an issue
//                                 (byIssue; startPolling wired by the shell)

export { AgentStateBadge } from "./AgentStateBadge";
export { AutomationDeliveryChicklet } from "./AutomationDeliveryChicklet";
export { AutomationFailureChicklet } from "./AutomationFailureChicklet";
export { ConversationStateBadge } from "./ConversationStateBadge";
export { ScratchStateBadge } from "./ScratchStateBadge";
