import { endGuidedTourAfterFirstModule, onboardCodexAndCreateModule } from "../desktop-studio-ui.mjs";
import { buildCoreWorkflow } from "./core-workflow-operations.mjs";
import { moduleNamed, onlyProject } from "./persisted-facts.mjs";

const MODULE_NAME = "Subtree Module";

/**
 * The core campaign fixture, once per installation: onboarding (Codex) and a
 * trusted module through the visible UI, with the guided tour ended after its
 * first-module step (core has no Story capture), then the minimal subtree
 * workflow built through the existing generated workflow operations, because
 * the core edition seeds none. Returns the same shape as the Pocock fixture.
 */
export async function prepareCoreInstallation(installation) {
  const { browser, dataDirectory, workspaceDirectory } = installation;
  await onboardCodexAndCreateModule(browser, { workspaceDirectory, moduleName: MODULE_NAME });
  await endGuidedTourAfterFirstModule(browser);
  const project = await onlyProject(dataDirectory);
  const module = await moduleNamed(dataDirectory, project.id, MODULE_NAME);

  const { catalog, steps } = await buildCoreWorkflow(browser, project.id);
  console.log(steps.length > 0
    ? `Core workflow built with ${steps.length} generated operations: ${steps.map((step) => step.kind).join(", ")}.`
    : "Core workflow: the project already holds every named state, type, edge and binding; adopted unchanged.");
  await expectStoriesPaneConfigured(browser);

  const state = (name) => catalog.states.find((candidate) => candidate.name === name);
  const type = (name) => catalog.issueTypes.find((candidate) => candidate.name === name);
  return {
    project,
    module,
    states: { implement: state("Implement"), review: state("Review") },
    types: { story: type("Story"), implementation: type("Implementation") },
  };
}

/** The Stories pane reads the new workflow: no "No workflow yet", idea capture enabled. */
async function expectStoriesPaneConfigured(browser) {
  await browser.refresh();
  const pane = await browser.$('[data-testid="tasks-pane-body"]');
  await pane.waitForDisplayed({ timeout: 30_000, timeoutMsg: "the Stories pane did not render" });
  await browser.waitUntil(async () => {
    const text = await pane.getText().catch(() => "");
    const capture = await browser.$("aria/Capture an idea");
    return !text.includes("No workflow yet") && await capture.isEnabled().catch(() => false);
  }, { timeout: 30_000, timeoutMsg: "the Stories pane still reads \"No workflow yet\" after the core workflow was built" });
}
