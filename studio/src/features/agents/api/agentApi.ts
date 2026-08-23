import {
  createTerminalSession,
  resumeTerminalSession,
  terminateTerminalSession,
  type ResumeTerminalRunInput,
} from "../terminal/internal/mutationTransport";

export const terminateTerminal = terminateTerminalSession;
export const resumeTerminal = (input: ResumeTerminalRunInput) =>
  resumeTerminalSession(input);
export interface CreateTerminalRunRequest {
  agent: "claude" | "agy" | "codex" | "gemini";
  project_id: string;
  module_id: string;
  task_id: string | null;
  initial_prompt: string | null;
  is_planning: boolean;
  is_instant: boolean;
  instant_prompt: string | null;
}

export const createTerminalRun = (body: CreateTerminalRunRequest) =>
  createTerminalSession({
    agent: body.agent,
    projectId: body.project_id,
    moduleId: body.module_id,
    taskId: body.task_id,
    initialPrompt: body.is_instant ? body.instant_prompt : body.initial_prompt,
    isPlanning: body.is_planning,
    isInstant: body.is_instant,
  });
