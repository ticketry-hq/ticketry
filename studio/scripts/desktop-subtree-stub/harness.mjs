import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { SUBTREE_STUB_MODES, subtreeStubPaths } from "./run-records.mjs";

/**
 * The harness side of the subtree stub protocol: scenarios script each stub's
 * timing through controls and signals and read its records, without editing
 * the stub. `root` is the installation root the approved `codex` wrapper
 * passes to the stub.
 */
export function subtreeStubHarness(root) {
  const paths = subtreeStubPaths(root);
  const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined);
  // Write then rename, so a polling stub never reads a half-written file.
  function writeAtomically(file, contents) {
    mkdirSync(path.dirname(file), { recursive: true });
    const staged = `${file}.${process.pid}.tmp`;
    writeFileSync(staged, contents);
    renameSync(staged, file);
  }
  function validControl(control) {
    if (!SUBTREE_STUB_MODES.includes(control?.mode)) {
      throw new Error(`Subtree stub control needs a mode of ${SUBTREE_STUB_MODES.join(", ")}`);
    }
    return JSON.stringify(control);
  }
  async function waitFor(read, description, { timeoutMillis = 30_000, intervalMillis = 50 } = {}) {
    const deadline = Date.now() + timeoutMillis;
    for (;;) {
      const value = read();
      if (value !== undefined) return value;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}`);
      await delay(intervalMillis);
    }
  }
  function failIfErrored(agentRunId) {
    const error = readJson(paths.run(agentRunId).error);
    if (error) throw new Error(`Subtree stub ${agentRunId} failed: ${error.message}`);
    return undefined;
  }
  const runIds = () => (existsSync(paths.runsDirectory) ? readdirSync(paths.runsDirectory) : []);
  const startRecords = () => runIds().map((id) => readJson(paths.run(id).start)).filter(Boolean)
    .sort((left, right) => (BigInt(left.monotonic_ns) < BigInt(right.monotonic_ns) ? -1 : 1));

  return {
    paths,
    // Applies to every run launched for this work item.
    controlWorkItem(workItemId, control) { writeAtomically(paths.workItemControl(workItemId), validControl(control)); },
    // Overrides the work-item control for one run; read when the stub decides.
    controlRun(agentRunId, control) { writeAtomically(paths.run(agentRunId).control, validControl(control)); },
    // Lets a held stub move. `exitAfterMove` keeps it alive until `signalExit`.
    release(agentRunId, { exitAfterMove = false } = {}) {
      writeAtomically(paths.run(agentRunId).release, JSON.stringify({ exitAfterMove }));
    },
    signalExit(agentRunId) { writeAtomically(paths.run(agentRunId).exit, ""); },
    startRecords,
    startRecord: (agentRunId) => readJson(paths.run(agentRunId).start),
    movedRecord: (agentRunId) => readJson(paths.run(agentRunId).moved),
    completionRecord: (agentRunId) => readJson(paths.run(agentRunId).completion),
    errorRecord: (agentRunId) => readJson(paths.run(agentRunId).error),
    mcpResponses(agentRunId) {
      const file = paths.run(agentRunId).mcp;
      return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
    },
    hooks(agentRunId) {
      const file = paths.run(agentRunId).hooks;
      return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean) : [];
    },
    // Resolves with the first start record matching `{ agentRunId?, workItemId? }`.
    waitForStart({ agentRunId, workItemId } = {}, options) {
      return waitFor(() => startRecords().find((record) => (!agentRunId || record.agent_run_id === agentRunId)
        && (!workItemId || record.work_item_id === workItemId)), `a subtree stub start ${agentRunId ?? workItemId ?? ""}`, options);
    },
    waitForMove(agentRunId, options) {
      return waitFor(() => failIfErrored(agentRunId) ?? readJson(paths.run(agentRunId).moved), `subtree stub ${agentRunId} to move`, options);
    },
    waitForCompletion(agentRunId, options) {
      return waitFor(() => failIfErrored(agentRunId) ?? readJson(paths.run(agentRunId).completion), `subtree stub ${agentRunId} to complete`, options);
    },
  };
}
