import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const studio = fileURLToPath(new URL("../", import.meta.url));
const vitest = fileURLToPath(new URL("../../node_modules/vitest/vitest.mjs", import.meta.url));
const cases = readdirSync(new URL("../src/test/", import.meta.url))
  .filter((name) => /^overhaul.*Acceptance\.test\.tsx$/.test(name))
  .map((name) => `src/test/${name}`);
const common = process.argv.slice(2);
let failed = false;
for (const args of [
  ["run", ...cases, "src/test/studioRenameBehaviour.test.tsx", ...common],
  ["run", "--config", "vitest.roadmap-off.config.ts", ...common],
]) {
  const result = spawnSync(process.execPath, [vitest, ...args], { cwd: studio, stdio: "inherit" });
  if (result.error) console.error(result.error.message);
  failed ||= result.status !== 0;
}
process.exitCode = failed ? 1 : 0;
