#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

function resolveCandidate(candidate) {
  if (!candidate) return null;
  const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(rootDir, candidate);
  return fs.existsSync(absolute) ? absolute : null;
}

const platform = process.platform;
const candidates = [];
if (platform === "darwin") {
  candidates.push(process.env.TICKETRY_HOOK_BINARY);
  candidates.push(`studio/src-tauri/binaries/ticketry-hook-${process.arch}-apple-darwin`);
}
candidates.push(process.env.TICKETRY_HOOK_BINARY_PATH);
candidates.push("studio/src-tauri/binaries/ticketry-hook-aarch64-apple-darwin");
candidates.push("studio/src-tauri/target/debug/ticketry-hook");
candidates.push("studio/target/debug/ticketry-hook");
candidates.push("studio/src-tauri/target/release/ticketry-hook");
candidates.push("studio/target/release/ticketry-hook");

const binaryPath = candidates
  .map(resolveCandidate)
  .find(Boolean);
const command = binaryPath ?? "ticketry-hook";

if (!binaryPath && !process.env.TICKETRY_HOOK_BINARY) {
  console.error("Unable to locate local ticketry-hook binary. Falling back to `ticketry-hook` in PATH.");
}

const dataDir = path.resolve(process.env.TICKETRY_MCP_DATA_DIR ?? path.join(rootDir, ".ticketry-mcp"));
const agentRunId = process.env.TICKETRY_MCP_RUN_ID || `pi-${process.pid}-${Date.now()}`;

fs.mkdirSync(dataDir, { recursive: true });

const result = spawnSync(command, ["mcp", "--data-dir", dataDir, "--agent-run-id", agentRunId], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error("Failed to launch ticketry-hook:", result.error.message);
  process.exit(1);
}

if (result.status === null) {
  console.error("ticketry-hook exited with a signal and no exit status.");
  process.exit(1);
}

process.exit(result.status);
