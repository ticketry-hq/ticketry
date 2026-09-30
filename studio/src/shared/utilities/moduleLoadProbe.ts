import { compactWorktrackerId } from "../api/generatedWorktracker";

type Details = Record<string, string | number | boolean>;
type Trace = {
  id: number;
  moduleId: string;
  started: number;
  treeBuilds: number;
  treeMs: number;
  rowBuilds: number;
  rowMs: number;
};
const traceLifetimeMs = 120_000;
let sequence = 0;
let current: Trace | undefined;

/** Dev-only, bounded timing metadata. Never retains task records or descriptions. */
export function beginModuleLoad(moduleId: string): void {
  if (!import.meta.env.DEV || import.meta.env.MODE === "test") return;
  current = { id: ++sequence, moduleId: compactWorktrackerId(moduleId), started: performance.now(), treeBuilds: 0, treeMs: 0, rowBuilds: 0, rowMs: 0 };
  moduleLoadPoint(moduleId)("selection-start");
}

export function moduleLoadProbeActive(moduleId: string | null): boolean {
  return Boolean(current && moduleId && current.moduleId === compactWorktrackerId(moduleId)
    && performance.now() - current.started <= traceLifetimeMs);
}

/** Capture the selection now so late requests cannot be attributed to a newer switch. */
export function moduleLoadPoint(moduleId: string | null) {
  const trace = current;
  return (stage: string, details: Details = {}) => {
    if (!trace || !moduleId || trace.moduleId !== compactWorktrackerId(moduleId)) return;
    const elapsed = performance.now() - trace.started;
    if (elapsed > traceLifetimeMs) return;
    // Every task row builds a tree. Aggregate that work instead of logging once
    // per row, which both floods the bridge and used to hide commit/paint events.
    if (stage === "tree-materialized") {
      trace.treeBuilds++;
      trace.treeMs += Number(details.materialize_ms ?? 0);
      return;
    }
    if (stage === "rows-derived") {
      trace.rowBuilds++;
      trace.rowMs += Number(details.derive_ms ?? 0);
      return;
    }
    console.info("[module-load]", JSON.stringify({
      selection_id: trace.id, module_id: trace.moduleId, stage,
      elapsed_ms: Math.round(elapsed * 10) / 10,
      tree_builds: trace.treeBuilds, tree_build_ms: Math.round(trace.treeMs * 10) / 10,
      row_builds: trace.rowBuilds, row_build_ms: Math.round(trace.rowMs * 10) / 10,
      ...details,
    }));
  };
}
