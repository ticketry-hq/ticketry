import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseFeatureSuite } from "../../src/test/feature-map/featureSuites.mjs";

/** Derive project routing from suite declarations, never a separate registry. */
export function featurePlaywrightProjects(e2eDirectory, browserUse) {
  const featuresDirectory = resolve(e2eDirectory, "features");
  const paths = existsSync(featuresDirectory) ? readdirSync(featuresDirectory)
    .filter((file) => file.endsWith(".spec.ts"))
    .map((file) => resolve(featuresDirectory, file))
    .filter((path) => parseFeatureSuite(readFileSync(path, "utf8"), path).declarations[0]?.profile === "first-run") : [];
  const escapedPaths = paths.map((path) => path.replace(/\\/g, "/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const firstRun = paths.length ? new RegExp(`^(?:${escapedPaths.join("|")})$`) : /(?!)/;
  return [
    { name: "setup", testMatch: /.*\.setup\.ts/, use: browserUse },
    { name: "chromium", dependencies: ["setup"], testIgnore: [/.*\.setup\.ts/, firstRun], use: browserUse },
    { name: "first-run", testMatch: firstRun, use: browserUse },
  ];
}
