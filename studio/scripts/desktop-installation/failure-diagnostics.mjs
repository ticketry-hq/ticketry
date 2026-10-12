import { copyFileSync, cpSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { studioRoot } from "./acceptance-build.mjs";

/**
 * Copies one failed run's evidence into the ignored `studio/test-results/`
 * desktop diagnostics directory before the temporary root is removed.
 */
export async function captureFailureDiagnostics(installation, { label, evidenceFiles }) {
  const { artifacts, browser, root } = installation;
  if (browser) {
    await browser.saveScreenshot(path.join(artifacts, "failure.png")).catch(() => {});
    const diagnostic = await browser.execute(() => ({
      body: document.body?.innerText ?? "",
      html: document.documentElement?.outerHTML ?? "",
      href: window.location.href,
      readyState: document.readyState,
      consoleErrors: window.__ticketryAcceptanceDiagnostics ?? [],
    })).catch((cause) => ({ diagnosticError: String(cause) }));
    writeFileSync(
      path.join(artifacts, "frontend-diagnostic.json"),
      JSON.stringify(diagnostic, null, 2),
    );
  }
  const readiness = path.join(installation.dataDirectory, "slice2-readiness.json");
  if (existsSync(readiness)) copyFileSync(readiness, path.join(artifacts, "slice2-readiness.json"));
  writeFileSync(path.join(artifacts, "ticketry.stdout.log"), Buffer.concat(installation.stdout));
  writeFileSync(path.join(artifacts, "ticketry.stderr.log"), Buffer.concat(installation.stderr));
  writeFileSync(path.join(artifacts, "tmux-inventory.txt"), installation.tmuxInventory());
  writeFileSync(path.join(artifacts, "provider-output.log"), installation.tmuxCapture());
  for (const evidence of evidenceFiles) {
    const source = path.join(root, evidence);
    // An evidence entry may be a file or a whole directory of run records.
    if (existsSync(source)) cpSync(source, path.join(artifacts, evidence), { recursive: true });
  }
  const retainedArtifacts = path.join(studioRoot, "test-results", `${label}-${Date.now()}`);
  cpSync(artifacts, retainedArtifacts, { recursive: true });
  console.error(`Desktop acceptance failed. Artifacts: ${retainedArtifacts}`);
  return retainedArtifacts;
}
