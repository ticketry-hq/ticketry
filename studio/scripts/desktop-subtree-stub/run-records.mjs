import path from "node:path";

/**
 * Where the subtree stub and the harness exchange controls, signals and
 * evidence inside one installation root. Everything a run writes lives under
 * its own agent run id, so concurrent stubs never share a file.
 *
 *   subtree-stub/work-items/<workItemId>.control.json  control written before the press
 *   subtree-stub/runs/<agentRunId>/control.json        per-run control (takes precedence)
 *   subtree-stub/runs/<agentRunId>/start.json          start record
 *   subtree-stub/runs/<agentRunId>/release             release signal for a held stub
 *   subtree-stub/runs/<agentRunId>/moved.json          the stage move was accepted
 *   subtree-stub/runs/<agentRunId>/exit                exit signal after an exit-after-move
 *   subtree-stub/runs/<agentRunId>/completion.json     completion record
 *   subtree-stub/runs/<agentRunId>/mcp.jsonl           every MCP response, attempts included
 *   subtree-stub/runs/<agentRunId>/hooks.log           lifecycle events, in emission order
 *   subtree-stub/runs/<agentRunId>/error.json          why a stub failed
 */
export function subtreeStubPaths(root) {
  const base = path.join(root, "subtree-stub");
  const runsDirectory = path.join(base, "runs");
  const workItemsDirectory = path.join(base, "work-items");
  return {
    base,
    runsDirectory,
    workItemsDirectory,
    workItemControl: (workItemId) => path.join(workItemsDirectory, `${workItemId}.control.json`),
    run(agentRunId) {
      const directory = path.join(runsDirectory, agentRunId);
      return {
        directory,
        control: path.join(directory, "control.json"),
        start: path.join(directory, "start.json"),
        release: path.join(directory, "release"),
        moved: path.join(directory, "moved.json"),
        exit: path.join(directory, "exit"),
        completion: path.join(directory, "completion.json"),
        mcp: path.join(directory, "mcp.jsonl"),
        hooks: path.join(directory, "hooks.log"),
        error: path.join(directory, "error.json"),
      };
    },
  };
}

export const SUBTREE_STUB_MODES = Object.freeze(["complete", "hold", "exit-after-move"]);

// The stage each fixture child moves through when its control names none.
export const DEFAULT_NEXT_STAGE = Object.freeze({ Implement: "Review" });

// A comparable, system-wide monotonic clock reading (nanoseconds since boot).
export function monotonicNow() {
  return process.hrtime.bigint().toString();
}
