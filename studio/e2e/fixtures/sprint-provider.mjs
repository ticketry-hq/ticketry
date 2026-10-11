#!/usr/bin/env node
import { runWorkspaceProvider } from "./workspace-provider.mjs";
import { runProviderTitles } from "./provider-titles.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// This executable implements the production Codex exec file/stdin contract.
// Only the provider is a fixture; Rust validates and publishes its output.
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("codex-cli 0.0.0-ticketry-sprint-e2e");
  process.exit(0);
}
const root = process.env.TICKETRY_E2E_PROVIDER_DIR;
if (args[0] === "app-server") {
  await runProviderTitles();
  process.exit(0);
}
function option(name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}`);
  return args[index + 1];
}
if (!args.includes("--output-schema")) {
  await runWorkspaceProvider(root, args);
  process.exit(process.exitCode ?? 0);
}
if (!root || args[0] !== "exec") throw new Error("Sprint fixture requires isolated exec support");
if (process.env.TICKETRY_MCP_AUTHORIZATION || process.env.MUXED_AGENT_RUN_ID) {
  throw new Error("Typed execution must not receive interactive agent credentials");
}
const schema = JSON.parse(await readFile(option("--output-schema"), "utf8"));
if (!schema.properties?.suggestions) throw new Error("Missing typed suggestion schema");
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
const marker = "Planning snapshot:\n";
if (!prompt.includes(marker)) throw new Error("Missing planning snapshot");
const snapshot = JSON.parse(prompt.slice(prompt.indexOf(marker) + marker.length));
const control = JSON.parse(await readFile(join(root, "control.json"), "utf8"));
const id = basename(process.cwd());
await writeFile(join(root, `${id}.started.json`), JSON.stringify({
  id, pid: process.pid, mode: control.kind, args, projectId: snapshot.project_id,
  goalIds: snapshot.goals.map((goal) => goal.id),
}));
// Tests release the actual subprocess after inspecting the running application.
// Cancellation kills this process through the host's dedicated process group.
for (let attempt = 0; ; attempt++) {
  try { await readFile(join(root, `${id}.release`)); break; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (attempt > 1200) throw new Error("Fixture release timed out");
  await delay(100);
}
if (control.kind === "failure") process.exit(23);
if (control.kind !== "success") throw new Error("Delayed fixture must be cancelled");
if (control.empty) {
  await writeFile(option("--output-last-message"), JSON.stringify({ suggestions: [] }));
  process.exit(0);
}
const goal = snapshot.goals[0];
const prefix = control.prefix ?? "Planning";
const epic = snapshot.epics.find((row) => row.name === `${prefix} epic`);
if (!goal || !epic) throw new Error("Planning fixture goals/epic missing");
const names = control.refresh ? [`${prefix} waiting`]
  : [`${prefix} existing`, `${prefix} ungrouped`, `${prefix} waiting`];
const suggestions = names.map((name) => {
  const story = snapshot.backlog.find((row) => row.name === name);
  if (!story) throw new Error(`Missing backlog Story ${name}`);
  return { goal_id: goal.id, story: { kind: "existing", issue_id: story.id }, reason: `Supports ${goal.text}: ${name}` };
});
suggestions.push({ goal_id: goal.id, story: {
  kind: "proposed", name: control.refresh ? `${prefix} refreshed proposal` : `${prefix} proposal`, epic_id: epic.id,
}, reason: `Fills a gap for ${goal.text}` });
await writeFile(option("--output-last-message"), JSON.stringify({ suggestions }));
