import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EDITION, editionHas, type EditionCapability } from "./edition";

// Runs under the default (core) and the Pocock Vitest configurations, so each
// compiled edition is checked against the checked-in manifest exactly.
const manifest = JSON.parse(readFileSync(resolve(__dirname, "../../../../config/editions.json"), "utf8")) as {
  editions: string[];
  capabilities: Record<string, string[]>;
};

describe(`compiled ${EDITION} edition`, () => {
  it("is one of the manifest's editions", () => {
    expect(manifest.editions).toEqual(["pocock", "core"]);
    expect(manifest.editions).toContain(EDITION);
  });

  it("grants exactly the manifest's capabilities for this edition", () => {
    const granted = Object.keys(manifest.capabilities)
      .filter((capability) => editionHas(capability as EditionCapability)).sort();
    const expected = Object.entries(manifest.capabilities)
      .filter(([, editions]) => editions.includes(EDITION)).map(([capability]) => capability).sort();
    expect(granted).toEqual(expected);
  });

  it("knows every capability the manifest declares", () => {
    const known: Record<EditionCapability, true> = {
      sprintPlanning: true, launchkeyMidi: true, voiceTranscription: true,
      parallelSubtreeRuns: true, reviewedWorkflowDefaults: true,
    };
    expect(Object.keys(manifest.capabilities).sort()).toEqual(Object.keys(known).sort());
  });
});
