import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const entry = `# Startup
Startup behavior.
Surfaces: browser, desktop
Editions: pocock, core

## Sub-features
- startup-ready: Startup becomes ready.
## How to get to it
Launch Ticketry.
## Prerequisites
Use isolated data.
## Expected behavior
The app opens.
## Verifying it
Observe the ready screen.
## Relevant code
No extra code areas in this fixture.
## Gotchas
Wait for readiness.
`;

export function fixture(files: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "ticketry-feature-map-"));
  const map = join(root, "docs/feature-map");
  const contents = {
    "docs/feature-map/README.md": "# Map\n\n## Index\n[Startup](startup.md)\n\n## Exclusions\n| Code area | Reason |\n| --- | --- |\n",
    "docs/feature-map/startup.md": entry,
    ...files,
  };
  for (const [path, content] of Object.entries(contents)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return { root, map };
}
