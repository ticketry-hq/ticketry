// Launch parsing shared by the disposable desktop providers. Ticketry starts a
// Codex-compatible provider with a generated inline TOML table whose strings
// and arrays use JSON escaping, the packaged hook command, and the factual
// launch prompt as the final argument.

// The packaged stdio MCP bridge and the authorization variable it forwards.
export function parseProviderLaunch(argv, environment) {
  const config = argv.find((value) => value.startsWith("mcp_servers=")) ?? "";
  const command = config.match(/command=("(?:[^"\\]|\\.)*")/);
  const args = config.match(/args=(\[.*?\]),command=/);
  if (!command || !args || !config.includes('env_vars=["TICKETRY_MCP_AUTHORIZATION"]')) {
    throw new Error("Acceptance provider requires the packaged stdio MCP configuration");
  }
  if (!environment.TICKETRY_MCP_AUTHORIZATION) throw new Error("Missing MCP authorization");
  return { command: JSON.parse(command[1]), args: JSON.parse(args[1]), authorization: environment.TICKETRY_MCP_AUTHORIZATION };
}

// The packaged lifecycle hook runner command, run through `/bin/sh -c`.
export function parseHookCommand(argv) {
  const hooks = argv.find((value) => value.startsWith("hooks=")) ?? "";
  const match = hooks.match(/command=("(?:[^"\\]|\\.)*")/);
  if (!match) throw new Error("Missing lifecycle hook command");
  return JSON.parse(match[1]);
}

// The run identity the launch authority credentialed the bridge with.
export function bridgeAgentRunId(bridgeArgs) {
  const index = bridgeArgs.indexOf("--agent-run-id");
  return index >= 0 ? bridgeArgs[index + 1] : undefined;
}

// Factual lines of the launch prompt. The factual block is preferred so a
// workflow prompt or description that quotes these labels cannot mislead.
export function parseLaunchPrompt(prompt) {
  const marker = "Work item context (factual):\n";
  const start = prompt.indexOf(marker);
  let block = start >= 0 ? prompt.slice(start + marker.length) : prompt;
  const description = block.indexOf("\nDescription:\n");
  if (start >= 0 && description >= 0) block = block.slice(0, description);
  const line = (label) => block.match(new RegExp(`^${label}: (.+)$`, "m"))?.[1];
  return { workItemId: line("Work Item ID"), projectId: line("Project ID"), state: line("State") };
}

// Everything a subtree stub needs from its own launch: several stubs run at
// once, so no shared fallback file may supply any part of this identity.
export function parseSubtreeLaunch(argv, environment) {
  const bridge = parseProviderLaunch(argv, environment);
  const hookCommand = parseHookCommand(argv);
  const agentRunId = bridgeAgentRunId(bridge.args);
  if (!agentRunId) throw new Error("Missing --agent-run-id in the MCP bridge arguments");
  const prompt = argv.at(-1) ?? "";
  const { workItemId, projectId, state } = parseLaunchPrompt(prompt);
  if (!workItemId) throw new Error("Missing Work Item ID in the launch prompt");
  if (!projectId) throw new Error("Missing Project ID in the launch prompt");
  if (!state) throw new Error("Missing State in the launch prompt");
  return { bridge, hookCommand, agentRunId, workItemId, projectId, launchState: state, prompt };
}
