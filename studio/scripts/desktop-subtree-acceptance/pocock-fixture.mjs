import { onboardCodexWithModule } from "../desktop-studio-ui.mjs";
import { moduleNamed, onlyProject, workflowCatalog } from "./persisted-facts.mjs";

const MODULE_NAME = "Subtree Module";

/**
 * The Pocock campaign fixture: onboarding (Codex) and a trusted module through
 * the visible UI, then the seeded reviewed-defaults workflow used unchanged.
 * Once per installation.
 */
export async function preparePocockInstallation(installation) {
  const { browser, dataDirectory, workspaceDirectory } = installation;
  await onboardCodexWithModule(browser, { workspaceDirectory, moduleName: MODULE_NAME });
  const project = await onlyProject(dataDirectory);
  const module = await moduleNamed(dataDirectory, project.id, MODULE_NAME);
  const catalog = await workflowCatalog(browser, project.id);
  const named = (nodes, name, kind) => {
    const found = nodes.find((node) => node.name === name);
    if (!found) throw new Error(`the reviewed-defaults workflow has no ${kind} ${name}`);
    return found;
  };
  return {
    project,
    module,
    states: { implement: named(catalog.states.nodes, "Implement", "state"), review: named(catalog.states.nodes, "Review", "state") },
    types: { story: named(catalog.issue_types.nodes, "Story", "issue type"), implementation: named(catalog.issue_types.nodes, "Implementation", "issue type") },
  };
}
