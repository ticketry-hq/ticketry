// Generated from operations/outputActivity.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../../graphql-foundation/typedDocument";

export interface TerminalOutputObservationPayload {
  readonly advanced: boolean;
  readonly output_sequence: number;
  readonly last_output_at: string | null;
}

export interface ObserveTerminalOutputVariables {
  readonly agentRunId: string;
}
export interface ObserveTerminalOutputMutation {
  readonly observation: TerminalOutputObservationPayload;
}

export const ObserveTerminalOutputDocument = {
  kind: "Document",
  operationName: "ObserveTerminalOutput",
  source: "mutation ObserveTerminalOutput($agentRunId: String!) {\n  observation: terminal_output_observe(agent_run_id: $agentRunId) {\n    advanced\n    output_sequence\n    last_output_at\n  }\n}",
} as TypedDocumentNode<ObserveTerminalOutputMutation, ObserveTerminalOutputVariables>;
