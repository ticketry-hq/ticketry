// Lifecycle module — the agent-state axis (#498) as a droppable unit.
//
// Import ONLY from this file. The interface:
//   <AgentStateBadge issueKey />  the live agent-state chip for an issue
//                                 (byIssue; startPolling wired by the shell)

export { AgentStateBadge } from "./AgentStateBadge";
export { AutomationFailureChicklet } from "./AutomationFailureChicklet";
