export const AGENT_RUN_ACTIONS = {
  focusAgentRun: "focus-agent-run",
  toggleVoiceTranscription: "toggle-voice-transcription",
  submitSelectedRunTerminal: "submit-selected-run-terminal",
} as const;

export type AgentRunActionId =
  (typeof AGENT_RUN_ACTIONS)[keyof typeof AGENT_RUN_ACTIONS];
