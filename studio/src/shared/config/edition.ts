/** Injected by frontend build configuration; changing the edition requires rebuilding. */
declare const __TICKETRY_EDITION__: Edition;

export type Edition = "pocock" | "core";
export type EditionCapability =
  | "sprintPlanning" | "launchkeyMidi" | "voiceTranscription"
  | "parallelSubtreeRuns" | "reviewedWorkflowDefaults";

/** Mirrors `config/editions.json`; the edition parity test keeps the two equal. */
const CAPABILITY_EDITIONS: Record<EditionCapability, readonly Edition[]> = {
  sprintPlanning: ["core"],
  launchkeyMidi: ["core"],
  voiceTranscription: ["core"],
  parallelSubtreeRuns: ["core"],
  reviewedWorkflowDefaults: ["pocock"],
};

export const EDITION: Edition = __TICKETRY_EDITION__;

export function editionHas(capability: EditionCapability): boolean {
  return CAPABILITY_EDITIONS[capability].includes(EDITION);
}
