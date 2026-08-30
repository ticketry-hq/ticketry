import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supportedEnvironment = new Set([
  "MUXED_DATA_DIR",
  "MUXED_DESKTOP_MCP_PORT",
  "MUXED_FRONTEND_PORT",
  "MUXED_TMUX_SOCKET",
  "TICKETRY_GRAPHQL_ADAPTER_PORT",
]);

export const defaultWebDevConfigPath = path.join(
  root,
  ".ticketry-dev",
  "web-defaults.json",
);

export function loadWebDevDefaults({
  configPath = defaultWebDevConfigPath,
  environment = process.env,
} = {}) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        environment: { ...environment },
        logToFile: false,
        reuseGraphqlAdapter: false,
      };
    }
    throw new Error(`Could not read web defaults from ${configPath}: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Web defaults in ${configPath} must be a JSON object`);
  }
  if (parsed.environment !== undefined
      && (!parsed.environment
        || typeof parsed.environment !== "object"
        || Array.isArray(parsed.environment))) {
    throw new Error(`Web defaults environment in ${configPath} must be a JSON object`);
  }
  if (parsed.logToFile !== undefined && typeof parsed.logToFile !== "boolean") {
    throw new Error(`Web defaults logToFile in ${configPath} must be a boolean`);
  }
  if (parsed.overrideEnvironment !== undefined
      && typeof parsed.overrideEnvironment !== "boolean") {
    throw new Error(`Web defaults overrideEnvironment in ${configPath} must be a boolean`);
  }
  if (parsed.reuseGraphqlAdapter !== undefined
      && typeof parsed.reuseGraphqlAdapter !== "boolean") {
    throw new Error(`Web defaults reuseGraphqlAdapter in ${configPath} must be a boolean`);
  }

  const configured = { ...environment };
  for (const [name, value] of Object.entries(parsed.environment ?? {})) {
    if (!supportedEnvironment.has(name)) {
      throw new Error(`Web defaults in ${configPath} contain unsupported setting ${name}`);
    }
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`Web default ${name} in ${configPath} must be a non-empty string`);
    }
    if (parsed.overrideEnvironment || !configured[name]) configured[name] = value;
  }
  return {
    environment: configured,
    logToFile: parsed.logToFile ?? false,
    reuseGraphqlAdapter: parsed.reuseGraphqlAdapter ?? false,
  };
}
