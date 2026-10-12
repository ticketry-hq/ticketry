import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { checkFeatureSuites } from "./feature-map/checkFeatureSuites.mjs";
import { suiteEntry, suiteFixture, suiteSource } from "./feature-map/featureSuiteFixtures";

const roots: string[] = [];
function check(files: Record<string, string> = {}, removed: string[] = []) {
  const { root, map, e2e } = suiteFixture(files);
  roots.push(root);
  for (const path of removed) rmSync(join(root, path), { force: true });
  return checkFeatureSuites(map, e2e, root);
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe("feature suite drift contract", () => {
  it("accepts a complete minimal map and suite", () => { expect(check()).toEqual([]); });
  it("accepts a reasoned manual exclusion without a suite or table", () => {
    const excluded = suiteEntry.replace(/Suite:[^]*?(?=## Relevant code)/, "Suite: excluded (manual): Requires hardware\n\n");
    expect(check({ "docs/feature-map/startup.md": excluded }, ["studio/e2e/features/startup.spec.ts"])).toEqual([]);
  });
  it("reports the exact missing suite file", () => {
    expect(check({}, ["studio/e2e/features/startup.spec.ts"]))
      .toEqual(expect.arrayContaining([expect.objectContaining({ rule: 1, message: expect.stringContaining("missing suite file studio/e2e/features/startup.spec.ts") })]));
  });
  it.each(["", "n/a:", "desktop-only:", "manual:", "@case-ready prose", "@case-READY"])("rejects invalid coverage cell %s", (cell) => {
    expect(check({ "docs/feature-map/startup.md": suiteEntry.replace("| @case-ready |", `| ${cell} |`) }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ rule: 7, message: expect.stringContaining("startup-ready / Success") })]));
  });
  it("rejects a tag belonging to another feature's suite", () => {
    expect(check({
      "docs/feature-map/startup.md": suiteEntry.replace("| @case-ready |", "| @case-other |"),
      "studio/e2e/features/other.spec.ts": suiteSource.replace("'startup'", "'other'").replace("@case-ready", "@case-other"),
    })).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 7, message: expect.stringContaining("missing case @case-other") })]));
  });
  it("reports missing and extra coverage columns", () => {
    expect(check({ "docs/feature-map/startup.md": suiteEntry.replace("| Error |", "| Unknown |") }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ rule: 6, message: expect.stringContaining("missing coverage column Error") }),
        expect.objectContaining({ rule: 6, message: expect.stringContaining("extra coverage column Unknown") }),
      ]));
  });
  it("rejects a listed non-feature spec with an empty reason or nonexistent path", () => {
    expect(check({ "docs/feature-map/README.md": "# Map\n## Non-feature browser specs\n| Spec | Reason |\n| --- | --- |\n| studio/e2e/missing.spec.ts | |" }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ rule: 9, message: expect.stringContaining("missing non-feature spec reason") }),
        expect.objectContaining({ rule: 9, message: expect.stringContaining("missing listed non-feature spec studio/e2e/missing.spec.ts") }),
      ]));
  });
  it("finds nested non-feature specs and accepts their reasoned listing", () => {
    expect(check({
      "docs/feature-map/README.md": "# Map\n## Non-feature browser specs\n| Spec | Reason |\n| --- | --- |\n| studio/e2e/nested/contract.spec.ts | Public contract |",
      "studio/e2e/nested/contract.spec.ts": "",
    })).toEqual([]);
  });
  it("rejects a coverage table attached to an excluded entry", () => {
    expect(check({ "docs/feature-map/startup.md": suiteEntry.replace("studio/e2e/features/startup.spec.ts", "excluded (manual): Requires MIDI hardware") }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ rule: 1, message: expect.stringContaining("extra coverage table") })]));
  });
  it("reports rule 9 and an unlisted browser spec", () => {
    expect(check({ "studio/e2e/legacy.spec.ts": "" }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ rule: 9, path: "studio/e2e/legacy.spec.ts", message: expect.stringContaining("missing Non-feature browser specs row") })]));
  });
  it("reports rule 8 and the uncited case identifier", () => {
    expect(check({ "studio/e2e/features/startup.spec.ts": suiteSource.replace("test('ready", "test('uncited @case-uncited', () => {});\n  test('ready") }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ rule: 8, message: expect.stringContaining("uncited case @case-uncited") })]));
  });
  it("reports rule 7 when a cell cites a missing case in its own suite", () => {
    expect(check({ "docs/feature-map/startup.md": suiteEntry.replace("| @case-ready |", "| @case-missing |") }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ rule: 7, message: expect.stringContaining("missing case @case-missing") })]));
  });
  it("reports rule 6 and the exact missing and extra sub-feature rows", () => {
    expect(check({ "docs/feature-map/startup.md": suiteEntry.replace("| startup-ready |", "| unexpected-row |") }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ rule: 6, message: expect.stringContaining("missing coverage row startup-ready") }),
        expect.objectContaining({ rule: 6, message: expect.stringContaining("extra coverage row unexpected-row") }),
      ]));
  });
  it.each(["skip", "fixme", "only"])("reports rule 5 and forbidden test.%s calls", (method) => {
    expect(check({ "studio/e2e/features/startup.spec.ts": suiteSource.replace("test('ready", `test.${method}('ready`) }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ rule: 5, message: expect.stringContaining(`test.${method}`) })]));
  });
  it("reports rule 4 and the duplicate case identity across suites", () => {
    expect(check({ "studio/e2e/features/other.spec.ts": suiteSource.replace("'startup'", "'other'") }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ rule: 4, message: expect.stringContaining("duplicate case identifier ready") })]));
  });
  it("reports rule 3 and the mismatched declaration identifier", () => {
    expect(check({ "studio/e2e/features/startup.spec.ts": suiteSource.replace("'startup'", "'wrong'") }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ rule: 3, message: expect.stringContaining("wrong") })]));
  });
  it("reports rule 2 and the orphan suite path", () => {
    expect(check({ "studio/e2e/features/orphan.spec.ts": suiteSource.replace("'startup'", "'orphan'") }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ rule: 2, path: "studio/e2e/features/orphan.spec.ts", message: expect.stringContaining("orphan suite") })]));
  });
  it("reports rule 1 and the missing Suite line in the entry", () => {
    expect(check({ "docs/feature-map/startup.md": suiteEntry.replace("Suite: studio/e2e/features/startup.spec.ts", "") }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ rule: 1, path: "docs/feature-map/startup.md", message: expect.stringContaining("missing Suite:") })]));
  });
  describe("editions", () => {
    const coreSource = suiteSource.replace("test('ready @case-ready', async () => {});", "test('ready @case-ready', async () => {});\n  test('sprint @case-sprint', { tag: '@edition-core' }, async () => {});");
    const coreRow = "| startup-sprint | @case-sprint | n/a: No cancellation | n/a: No failure | n/a: No empty state | @case-sprint | @case-sprint |";
    const coreEntry = (marker = " (core)", editions = "pocock, core") => suiteEntry
      .replace("Editions: pocock, core", `Editions: ${editions}`)
      .replace("- startup-ready: Startup becomes ready.", `- startup-ready: Startup becomes ready.\n- startup-sprint${marker}: Sprint startup.`)
      .replace(/(\| startup-ready \|[^\n]*)/, `$1\n${coreRow}`);
    const editionViolations = (files: Record<string, string>) => check(files).filter((violation) => violation.rule === 10);
    it("accepts a core-marked sub-feature whose cases carry @edition-core", () => {
      expect(check({ "docs/feature-map/startup.md": coreEntry(), "studio/e2e/features/startup.spec.ts": coreSource })).toEqual([]);
    });
    it("accepts a describe-level @edition-core tag", () => {
      const source = suiteSource.replace("test('ready @case-ready', async () => {});", "test('ready @case-ready', async () => {});\n  test.describe('sprints', { tag: '@edition-core' }, () => { test('sprint @case-sprint', async () => {}); });");
      expect(check({ "docs/feature-map/startup.md": coreEntry(), "studio/e2e/features/startup.spec.ts": source })).toEqual([]);
    });
    it("reports a missing Editions: line", () => {
      expect(editionViolations({ "docs/feature-map/startup.md": suiteEntry.replace("Editions: pocock, core\n", "") }))
        .toEqual([expect.objectContaining({ path: "docs/feature-map/startup.md", message: expect.stringContaining("missing Editions: line") })]);
    });
    it("reports an illegal edition", () => {
      expect(editionViolations({ "docs/feature-map/startup.md": suiteEntry.replace("Editions: pocock, core", "Editions: enterprise") }))
        .toEqual([expect.objectContaining({ message: expect.stringContaining('illegal edition "enterprise"') })]);
    });
    it("reports @edition-core on a case of a Pocock-only feature", () => {
      expect(editionViolations({ "docs/feature-map/startup.md": coreEntry(" (core)", "pocock"), "studio/e2e/features/startup.spec.ts": coreSource }))
        .toEqual(expect.arrayContaining([expect.objectContaining({ path: "studio/e2e/features/startup.spec.ts", message: expect.stringContaining("@edition-core case @case-sprint in a feature without core") })]));
    });
    it("reports a core-marked sub-feature in a feature without core", () => {
      expect(editionViolations({ "docs/feature-map/startup.md": coreEntry(" (core)", "pocock"), "studio/e2e/features/startup.spec.ts": coreSource }))
        .toEqual(expect.arrayContaining([expect.objectContaining({ path: "docs/feature-map/startup.md", message: expect.stringContaining("core-only sub-feature startup-sprint in a feature without core") })]));
    });
    it("reports an @edition-core case cited by an unmarked sub-feature", () => {
      expect(editionViolations({ "docs/feature-map/startup.md": coreEntry(""), "studio/e2e/features/startup.spec.ts": coreSource }))
        .toEqual([expect.objectContaining({ message: expect.stringContaining("@edition-core case @case-sprint is cited by unmarked sub-feature startup-sprint") })]);
    });
    it("reports an untagged case cited only by core-only sub-features of a Pocock feature", () => {
      expect(editionViolations({ "docs/feature-map/startup.md": coreEntry(), "studio/e2e/features/startup.spec.ts": coreSource.replace(", { tag: '@edition-core' }", "") }))
        .toEqual([expect.objectContaining({ message: expect.stringContaining("case @case-sprint covers only core-only sub-features and needs @edition-core") })]);
    });
    it("reports an unknown edition tag", () => {
      expect(editionViolations({ "docs/feature-map/startup.md": coreEntry(), "studio/e2e/features/startup.spec.ts": coreSource.replace("@edition-core", "@edition-pocock") }))
        .toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("unknown edition tag @edition-pocock") })]));
    });
  });
});
