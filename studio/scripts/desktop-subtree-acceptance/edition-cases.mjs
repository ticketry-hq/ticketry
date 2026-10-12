/**
 * Which subtree cases each build edition runs, and which edition the running
 * app actually is.
 *
 * The case list is fixed data per edition, not a runtime flag: an edition can
 * only be tested with the cases its build ships. Only core ships the parallel
 * **Run subtree** control; crash and quit recovery runs in both editions.
 */
export const SUBTREE_CASES = Object.freeze({
  pocock: Object.freeze(["serial", "recovery"]),
  core: Object.freeze(["serial", "parallel", "recovery"]),
});

export function casesForEdition(edition) {
  const cases = SUBTREE_CASES[edition];
  if (!cases) throw new Error(`The desktop subtree journey has no case list for unknown edition ${JSON.stringify(edition)}`);
  if (cases.length === 0) {
    throw new Error(`The desktop subtree journey has no ${edition} subtree cases yet; build the pocock edition instead.`);
  }
  return [...cases];
}

// Sprint tools are published only by the core edition's MCP registry.
const CORE_ONLY_TOOLS = Object.freeze(["list_sprints", "get_sprint_goals", "suggest_sprint_story"]);

/** The edition a global MCP tool list belongs to, from its sprint tools alone. */
export function editionFromMcpTools(toolNames) {
  const present = CORE_ONLY_TOOLS.filter((name) => toolNames.includes(name));
  if (present.length === CORE_ONLY_TOOLS.length) return "core";
  if (present.length === 0) return "pocock";
  throw new Error(`The running app publishes a partial sprint tool set (${present.join(", ")}); its edition is ambiguous`);
}

/**
 * Requires the running app to be the requested edition by everything it
 * observably reports: the `edition` in its runtime configuration, when the
 * build publishes one, and its edition-filtered global MCP tool list.
 */
export function assertRunningEdition(requested, { runtimeEdition, toolNames }) {
  const mismatch = (source, running) => new Error(
    `The desktop subtree journey requested the ${requested} edition but the running app's ${source} is ${running}`,
  );
  if (runtimeEdition !== undefined && runtimeEdition !== requested) throw mismatch("runtime configuration", runtimeEdition);
  const advertised = editionFromMcpTools(toolNames);
  if (advertised !== requested) throw mismatch("MCP tool list", advertised);
  return requested;
}
