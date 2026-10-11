import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { entry } from "./fixtures";

export const columns = "Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence";
export const suiteEntry = entry.replace("## Relevant code", `## End-to-end suite
Suite: studio/e2e/features/startup.spec.ts

| ${columns} |
| --- | --- | --- | --- | --- | --- | --- |
| startup-ready | @case-ready | n/a: No cancellation | n/a: No failure | n/a: No empty state | @case-ready | @case-ready |

## Relevant code`);
export const suiteSource = `import { test } from '@playwright/test';
import { featureSuite } from './featureSuite';
featureSuite('startup', () => {
  test('ready @case-ready', async () => {});
});`;
export function suiteFixture(files: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "ticketry-feature-suites-"));
  for (const [path, content] of Object.entries({
    "docs/feature-map/README.md": "# Map\n[Startup](startup.md)\n\n## Non-feature browser specs\n| Spec | Reason |\n| --- | --- |\n",
    "docs/feature-map/startup.md": suiteEntry,
    "studio/e2e/features/startup.spec.ts": suiteSource,
    ...files,
  })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return { root, map: join(root, "docs/feature-map"), e2e: join(root, "studio/e2e") };
}
