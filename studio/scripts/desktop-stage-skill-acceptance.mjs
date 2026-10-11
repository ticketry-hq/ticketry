import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { click, openExistingStory } from "./desktop-studio-ui.mjs";

const skill = "ticketry-disposable-stage-skill";
const availabilityQuery = readFileSync(new URL("../src/features/agents/terminal/operations/stageSkillWarning.graphql", import.meta.url), "utf8");

async function availability(browser, agentRunId) {
  const encoded = await browser.execute((request) =>
    window.__TAURI_INTERNALS__.invoke("TauRPC__graphql_execute", { request_json: JSON.stringify(request) }),
  { query: availabilityQuery, operationName: "AgentRunStageSkillAvailability", variables: { agentRunId } });
  const response = JSON.parse(encoded);
  if (response.errors?.length) throw new Error(JSON.stringify(response.errors));
  const run = response.data?.agent_runs?.nodes?.find((candidate) => candidate.id.replaceAll("-", "") === agentRunId.replaceAll("-", ""));
  const raw = run?.stage_skill_availability;
  return { found: Boolean(run), id: run?.id, report: raw ? JSON.parse(raw) : null };
}

export function prepareStageSkillWorkspace(directory) {
  for (const args of [["init", "-b", "main"], ["-c", "user.name=Acceptance", "-c", "user.email=acceptance@example.invalid", "commit", "--allow-empty", "-m", "fixture"]]) {
    const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
  }
}

function installSkill(directory) {
  const folder = path.join(directory, ".agents", "skills", skill);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "SKILL.md"), `---\nname: ${skill}\ndescription: Disposable acceptance skill\n---\nOnly a fixture.\n`);
}

function snapshot(roots) {
  const entries = {};
  function visit(file) {
    if (!existsSync(file)) { entries[file] = null; return; }
    const stat = lstatSync(file);
    const children = readdirSync(file, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    entries[file] = { children: children.map((child) => child.name), mode: stat.mode, modified: stat.mtimeMs, changed: stat.ctimeMs };
    for (const child of children) {
      const target = path.join(file, child.name);
      if (child.isDirectory()) visit(target);
      else {
        const stat = lstatSync(target);
        entries[target] = { contents: readFileSync(target, "base64"), mode: stat.mode, modified: stat.mtimeMs, changed: stat.ctimeMs };
      }
    }
  }
  roots.forEach(visit);
  return JSON.stringify(entries);
}

export async function proveStageSkillLaunch({ browser, root, workspaceDirectory, taskId, codexHome, marker, inventory, capture, assertRenderer }) {
  console.log("Stage-skill acceptance: configuring the workflow and selected worktree.");
  await click(await browser.$("aria/Configure Ideas state"));
  const panel = await browser.$('[data-testid="state-configuration-panel"]');
  await panel.waitForDisplayed({ timeout: 30_000 });
  await click(await panel.$('button[role="tab"]*=Story'));
  const input = await panel.$('[aria-label="Skills"]');
  await input.setValue(skill);
  await browser.keys("Enter");
  await browser.waitUntil(async () => (await panel.getText()).includes(skill) && !(await panel.getText()).includes("Applying…"), { timeout: 20_000 });
  await click(await browser.$("aria/Close Ideas state configuration"));
  await openExistingStory(browser, taskId);
  await click(await browser.$("aria/+ Worktree"));
  await click(await browser.$("aria/Trust worktree"));
  await click(await browser.$("aria/Show worktree details"));
  const details = await browser.$('[data-testid="worktree-details"]');
  const checkout = (await details.$("div.break-all").getText()).trim();
  if (!checkout || checkout === workspaceDirectory || !existsSync(checkout)) throw new Error("Worktree UI did not resolve a separate checkout");
  await click(await browser.$("aria/Hide worktree details"));
  console.log(`Stage-skill acceptance: selected checkout ${checkout}`);

  // A module-only skill must not satisfy the provider running in its worktree.
  installSkill(workspaceDirectory);
  const roots = [path.join(workspaceDirectory, ".agents", "skills"), path.join(checkout, ".agents", "skills"), path.join(checkout, "skills"), path.join(codexHome, "skills")];
  const before = snapshot(roots);
  writeFileSync(path.join(root, "provider-stage-skills"), "");
  writeFileSync(path.join(root, "provider-task"), `${taskId}\nCoding\n`);

  async function launch(previousRun) {
    await click(await browser.$("aria/Run item"));
    const toast = await browser.$('//*[@data-testid and starts-with(@data-testid,"toast-") and contains(.,"Agent run")]');
    await toast.waitForDisplayed({ timeout: 20_000 });
    const acknowledgement = await toast.getText();
    if (!acknowledgement.includes("Agent run started.")) throw new Error(`Launch was not acknowledged in the UI: ${acknowledgement}`);
    await browser.waitUntil(async () => {
      if (!existsSync(marker)) return false;
      return JSON.parse(readFileSync(marker, "utf8")).agent_run_id !== previousRun;
    }, { timeout: 30_000, timeoutMsg: "Disposable provider did not acknowledge a fresh launch" });
    const provider = JSON.parse(readFileSync(marker, "utf8"));
    if (provider.cwd !== checkout || provider.task_id !== taskId) throw new Error("Provider did not use the selected worktree");
    if (!provider.prompt.includes(`Stage skills:\nUse these skills for this stage: [\"${skill}\"]`)) throw new Error("Stage-skill prompt changed or disappeared");
    if (provider.argv.some((arg) => arg.includes("cannot see stage skills:") || arg.includes("stage skill availability is unchecked"))) throw new Error("Warning leaked into provider arguments");
    await click(await browser.$("aria/Ideas codex terminal"));
    return provider;
  }
  const first = await launch();
  await assertRenderer();
  console.log(`Stage-skill acceptance: provider acknowledged ${first.agent_run_id}`);
  const firstObservation = await availability(browser, first.agent_run_id);
  console.log(`Stage-skill acceptance: authoritative observation ${JSON.stringify(firstObservation)}`);
  writeFileSync(path.join(root, "artifacts", "stage-skill-first-observation.json"), JSON.stringify(firstObservation, null, 2));
  const compactId = first.agent_run_id.replaceAll("-", "");
  const publicId = compactId.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  const warningSelector = [compactId, publicId].map((id) => `[data-testid="stage-skill-warning"][data-agent-run-id="${id}"]`).join(",");
  async function expectWarning() {
    const warning = await browser.$(warningSelector);
    await warning.waitForDisplayed({ timeout: 30_000 });
    const text = await warning.getText();
    if (!text.includes(skill) || !text.toLowerCase().includes("codex")) throw new Error(`Warning omitted skill/provider: ${text}`);
    const tag = await browser.$('[data-testid="terminal-mode-tag"]');
    if (await tag.isDisplayed().catch(() => false)) {
      const warningTop = await warning.getLocation("y");
      const warningSize = await warning.getSize();
      if (warningTop + warningSize.height > await tag.getLocation("y")) throw new Error("Terminal mode tag overlaps the stage-skill warning");
    }
  }
  await expectWarning();
  await browser.saveScreenshot(path.join(root, "artifacts", "first-warning.png"));
  writeFileSync(path.join(root, "artifacts", "stage-skill-first-run.json"), JSON.stringify({ agent_run_id: first.agent_run_id, cwd: first.cwd, task_id: first.task_id, warning: await (await browser.$(warningSelector)).getText() }, null, 2));
  if (capture().includes("cannot see stage skills:") || capture().includes("stage skill availability is unchecked")) throw new Error("Warning leaked into PTY output");
  await click(await browser.$("aria/Details"));
  await click(await browser.$("aria/Ideas codex terminal"));
  await expectWarning();
  await browser.refresh();
  await click(await browser.$(`[data-task-id="${taskId}"]`));
  await click(await browser.$("aria/Details"));
  await click(await browser.$("aria/Ideas codex terminal"));
  await expectWarning();
  if (snapshot(roots) !== before) throw new Error("Launch/check/reload wrote a skill tree");
  installSkill(checkout);
  const installed = snapshot(roots);
  const historical = await availability(browser, first.agent_run_id);
  if (!historical.report?.skills.some((entry) => entry.requested === skill && entry.status === "missing")) throw new Error("Installing a skill rewrote the historical warning");
  await expectWarning();
  writeFileSync(path.join(root, `provider-exit-${first.agent_run_id}`), "");
  await browser.waitUntil(async () => !inventory().includes(`|${first.agent_run_id}|0|`), { timeout: 30_000 });
  await click(await browser.$("aria/Details"));
  const second = await launch(first.agent_run_id);
  await browser.waitUntil(async () => {
    const result = await availability(browser, second.agent_run_id);
    return result.found && result.report === null;
  }, { timeout: 20_000, timeoutMsg: "Fresh launch did not persist an acknowledged run without a warning" });
  await browser.waitUntil(async () => !await (await browser.$('[data-testid="stage-skill-warning"]')).isDisplayed().catch(() => false), { timeout: 20_000 });
  if (snapshot(roots) !== installed) throw new Error("Recheck wrote a skill tree");
  writeFileSync(path.join(root, `provider-exit-${second.agent_run_id}`), "");
  const evidence = fileURLToPath(new URL(`../test-results/stage-skill-acceptance-${Date.now()}/`, import.meta.url));
  mkdirSync(evidence, { recursive: true });
  for (const name of ["first-warning.png", "stage-skill-first-run.json"]) copyFileSync(path.join(root, "artifacts", name), path.join(evidence, name));
  writeFileSync(path.join(evidence, "fresh-run.json"), JSON.stringify({ agent_run_id: second.agent_run_id, cwd: second.cwd, stage_skill_availability: null, skill_trees_unchanged: true }, null, 2));
  console.log(`Stage-skill artifacts: ${evidence}`);
  console.log(`Stage-skill evidence: first run ${first.agent_run_id}, fresh run ${second.agent_run_id}, provider CWD ${checkout}`);
  console.log("Stage-skill desktop acceptance passed: acknowledged worktree warning, persistent revisit/reload, clean fresh launch after install, no skill-tree writes.");
}
