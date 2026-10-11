import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { checkFeatureMap } from "./feature-map/checkFeatureMap";
import { entry, fixture } from "./feature-map/fixtures";

const roots: string[] = [];
function check(files: Record<string, string> = {}) {
  const { root, map } = fixture(files);
  roots.push(root);
  return checkFeatureMap(map, root);
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("feature map contract", () => {
  it("keeps the published map structurally sound", () => {
    const root = resolve(__dirname, "../../..");
    expect(checkFeatureMap(resolve(root, "docs/feature-map"), root)).toEqual([]);
  });
  it("rejects an entry omitted from the index", () => {
    expect(check({ "docs/feature-map/orphan.md": "# Orphan" })).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "index", path: "orphan.md" })]),
    );
  });
  it("accepts a complete minimal map", () => { expect(check()).toEqual([]); });
  it("accepts the optional end-to-end section in its contract position", () => {
    expect(check({ "docs/feature-map/startup.md": entry.replace("## Relevant code", "## End-to-end suite\nSuite: excluded (manual): Hardware fixture.\n\n## Relevant code") })).toEqual([]);
  });
  it("counts a plain Suite declaration as browser spec coverage", () => {
    expect(check({
      "docs/feature-map/startup.md": entry.replace("## Relevant code", "## End-to-end suite\nSuite: studio/e2e/features/startup.spec.ts\n\n## Relevant code"),
      "studio/e2e/features/startup.spec.ts": "test('startup', () => {});",
    })).toEqual([]);
  });
  it("rejects a missing browser spec declared by a plain Suite line", () => {
    expect(check({
      "docs/feature-map/startup.md": entry.replace("## Relevant code", "## End-to-end suite\nSuite: studio/e2e/features/startup.spec.ts\n\n## Relevant code"),
    })).toEqual([{
      code: "browser", path: "studio/e2e/features/startup.spec.ts", message: "Missing browser spec cited in startup.md",
    }]);
  });
  it.each([
    entry.replace("## Prerequisites", "## End-to-end suite\nSuite: excluded (manual): Hardware fixture.\n\n## Prerequisites"),
    entry.replace("## Relevant code", "## End-to-end suite\n\n## Relevant code"),
  ])("rejects a misplaced or empty optional end-to-end section", (content) => {
    expect(check({ "docs/feature-map/startup.md": content }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "structure" })]));
  });
  it("rejects an empty required section", () => {
    expect(check({ "docs/feature-map/startup.md": entry.replace("Wait for readiness.", "") }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "structure" })]));
  });
  it("rejects duplicate sub-feature identifiers across entries", () => {
    expect(check({
      "docs/feature-map/README.md": "# Map\n[Startup](startup.md)\n[Other](other.md)",
      "docs/feature-map/other.md": entry,
    })).toEqual(expect.arrayContaining([expect.objectContaining({ code: "identifier" })]));
  });
  it("rejects a nonempty feature area without coverage", () => {
    expect(check({ "studio/src/features/projects/index.ts": "export {};" }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "coverage", path: "studio/src/features/projects" })]));
  });
  it("rejects a nonexistent cited repository path", () => {
    expect(check({ "docs/feature-map/startup.md": entry.replace("No extra code areas in this fixture.", "`studio/src/features/missing`") }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "path", path: "studio/src/features/missing" })]));
  });
  it("rejects an unreferenced browser spec", () => {
    expect(check({ "studio/e2e/product.spec.ts": "test('product', () => {});" }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "browser", path: "studio/e2e/product.spec.ts" })]));
  });
  it("rejects a broken relative Markdown link", () => {
    expect(check({ "docs/feature-map/startup.md": `${entry}\n[Reference](../missing.md)` }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "link", path: "startup.md" })]));
  });
  it("counts Markdown links to code areas and browser specs as coverage", () => {
    expect(check({
      "docs/feature-map/startup.md": entry
        .replace("No extra code areas in this fixture.", "[Projects](../../studio/src/features/projects)")
        .replace("Observe the ready screen.", "[Browser coverage](../../studio/e2e/product.spec.ts)"),
      "studio/src/features/projects/index.ts": "export {};",
      "studio/e2e/product.spec.ts": "test('product', () => {});",
    })).toEqual([]);
  });
  it("ignores fenced examples when resolving links", () => {
    expect(check({ "docs/feature-map/startup.md": `${entry}\n\`\`\`md\n[example](missing.md)\n\`\`\`` })).toEqual([]);
  });
  it("reports malformed URL encodings instead of throwing", () => {
    expect(check({ "docs/feature-map/startup.md": `${entry}\n[Broken](bad%zz.md)` }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "link" })]));
  });
  it("accepts a one-character area title", () => {
    expect(check({ "docs/feature-map/startup.md": entry.replace("# Startup", "# X") })).toEqual([]);
  });
  it.each([
    ["missing H1", entry.replace("# Startup", "Startup")],
    ["missing surfaces", entry.replace("Surfaces: browser, desktop", "")],
    ["invalid surfaces", entry.replace("Surfaces: browser, desktop", "Surfaces: mobile")],
    ["wrong section order", entry.replace("## Prerequisites", "## Expected behavior").replace("## Expected behavior\nThe app", "## Prerequisites\nThe app")],
    ["extra section", `${entry}\n## Extra\nContent.`],
  ])("rejects entry structure: %s", (_name, content) => {
    expect(check({ "docs/feature-map/startup.md": content }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "structure" })]));
  });
  it.each(["UPPER-case", "wrong_id", "-bad-start"])("rejects malformed identifier %s", (id) => {
    expect(check({ "docs/feature-map/startup.md": entry.replace("startup-ready", id) }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "identifier" })]));
  });
  it("rejects duplicate index links", () => {
    expect(check({ "docs/feature-map/README.md": "# Map\n[Startup](startup.md)\n[Again](./startup.md)" }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "index" })]));
  });
  it("rejects nonexistent listed entries", () => {
    expect(check({ "docs/feature-map/README.md": "# Map\n[Startup](startup.md)\n[Missing](missing.md)" }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "index", path: "missing.md" })]));
  });
  it("rejects a missing cited browser spec", () => {
    expect(check({ "docs/feature-map/startup.md": entry.replace("Observe the ready screen.", "`studio/e2e/missing.spec.ts`") }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "browser" })]));
  });
  it("accepts a reasoned exclusion", () => {
    expect(check({
      "docs/feature-map/README.md": "# Map\n[Startup](startup.md)\n## Exclusions\n| Code area | Reason |\n| --- | --- |\n| `studio/src/features/plumbing` | Internal plumbing |",
      "studio/src/features/plumbing/index.ts": "export {};",
    })).toEqual([]);
  });
  it("rejects exclusion without a reason", () => {
    expect(check({
      "docs/feature-map/README.md": "# Map\n[Startup](startup.md)\n## Exclusions\n| Code area | Reason |\n| --- | --- |\n| `studio/src/features/plumbing` | |",
      "studio/src/features/plumbing/index.ts": "export {};",
    })).toEqual(expect.arrayContaining([expect.objectContaining({ code: "coverage" })]));
  });
  it("ignores empty leftover feature folders", () => {
    const { root, map } = fixture();
    roots.push(root);
    mkdirSync(resolve(root, "studio/src/features/removed/nested"), { recursive: true });
    expect(checkFeatureMap(map, root)).toEqual([]);
  });
  it("cannot use obsolete Pending rows to cover feature areas, app areas or browser specs", () => {
    expect(check({
      "docs/feature-map/README.md": "# Map\n[Startup](startup.md)\n## Pending\n| Code area | Ticket |\n| --- | --- |\n| `studio/src/features/projects` | CODING-2695 |\n| `studio/src/app/shell` | CODING-2695 |\n| `studio/e2e/product.spec.ts` | CODING-2695 |",
      "studio/src/features/projects/index.ts": "export {};",
      "studio/src/app/shell/index.ts": "export {};",
      "studio/e2e/product.spec.ts": "test('product', () => {});",
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "coverage", path: "studio/src/features/projects" }),
      expect.objectContaining({ code: "coverage", path: "studio/src/app/shell" }),
      expect.objectContaining({ code: "browser", path: "studio/e2e/product.spec.ts" }),
    ]));
  });
  it("resolves reference-style index, code and browser links", () => {
    expect(check({
      "docs/feature-map/README.md": "# Map\n[Startup][start]\n\n[start]: startup.md",
      "docs/feature-map/startup.md": entry.replace("No extra code areas in this fixture.", "[Projects][code]")
        .replace("Observe the ready screen.", "[Browser][coverage]")
        + "\n[code]: ../../studio/src/features/projects\n[coverage]: ../../studio/e2e/product.spec.ts\n",
      "studio/src/features/projects/index.ts": "export {};",
      "studio/e2e/product.spec.ts": "test('product', () => {});",
    })).toEqual([]);
  });
  it("rejects a broken reference-style link", () => {
    expect(check({ "docs/feature-map/startup.md": `${entry}\n[Reference][ref]\n[ref]: ../missing.md` }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "link" })]));
  });
  it("validates repository skill citations", () => {
    expect(check({ "docs/feature-map/startup.md": entry.replace("Observe the ready screen.", "`.claude/skills/missing/SKILL.md`") }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "path" })]));
  });
});
