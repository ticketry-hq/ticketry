import { useEffect, useRef } from "react";
import { editionHas } from "../../shared/config/edition";
import type { ModuleTabEntry } from "../module-tabs";
import { projectRunPresentation } from "../agents/status";
import { LifecycleBadge } from "../agents/terminal";
import { useModuleInspectionMetadata } from "./useModuleInspectionMetadata";
import { ModuleManagerActions } from "./ModuleManagerActions";
import { useManagerActions } from "./useManagerActions";
import { useModuleManagerStore } from "./state";

export interface ModuleManagerDetailProps {
  entry: ModuleTabEntry;
  folder?: string;
  onBack?: () => void;
  loading?: boolean;
}

/** Inspection never opens or restores a module's presentation. */
export function ModuleManagerDetail({ entry, folder, onBack, loading = false }: ModuleManagerDetailProps) {
  const { module } = entry;
  const metadata = useModuleInspectionMetadata(module.project_id, module.id);
  const actions = useManagerActions();
  const pending = useModuleManagerStore((state) => !!state.pendingActions[module.id]);
  const actionError = useModuleManagerStore((state) => state.actionErrors[module.id]);
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (onBack) backRef.current?.focus(); }, [!!onBack, module.id]);
  return <section role="region" aria-label={"Module details: " + module.name}
    className="min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-5 text-xs">
    {onBack ? <button ref={backRef} type="button" onClick={onBack} className="mb-4 px-2 py-1 text-text-muted hover:bg-pane-title focus-visible:outline focus-visible:outline-focus-accent">Back to modules</button> : null}
    <header className="mb-5 min-w-0">
      <p className="font-mono text-text-muted">{module.key}</p>
      <h2 className="mt-1 break-words text-sm font-semibold text-text-primary">{module.name}</h2>
      <p className="mt-2 text-text-muted">{entry.status === "archived" ? "Archived · inspection only" : entry.status === "hidden" ? "Tab hidden" : entry.status === "not-in-sprint" ? "Outside the current sprint filter" : "Tab open"}</p>
    </header>
    <div className="mb-5">
      <ModuleManagerActions entry={entry} loading={loading} pending={pending} surface="detail"
        onAction={(id, action) => { void actions(id, action); }} />
      {actionError ? <p role="alert" className="mt-2 break-words text-lifecycle-danger">{actionError} Use the action again to retry.</p> : null}
    </div>
    <dl className="space-y-5">
      <div><dt className="mb-1 text-text-muted">Local profile folder</dt><dd className="break-all">{folder ?? "Folder not linked"}</dd></div>
      {editionHas("sprintPlanning") ? <div><dt className="mb-1 text-text-muted">Sprint membership</dt><dd>
        {metadata.sprints.state === "available" ? metadata.sprints.memberships.length
          ? <ul className="space-y-1">{metadata.sprints.memberships.map((sprint) => <li key={sprint.id ?? "unsprinted"} className="break-words">{sprint.name}</li>)}</ul>
          : "No story sprint memberships"
          : metadata.sprints.state === "loading" ? <span role="status">Loading sprint membership…</span>
          : metadata.sprints.state === "unavailable" ? "Sprint membership unavailable" : "Sprint membership unknown"}
      </dd></div> : null}
      <div><dt className="mb-1 text-text-muted">Agents and lifecycle</dt><dd>
        {metadata.agents.state === "available" ? metadata.agentRuns.length
          ? <ul className="space-y-2">{metadata.agentRuns.map((run) => <li key={run.agent_run_id} className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="break-words">{run.agent ?? "Agent provider unknown"}</span>
            <LifecycleBadge state={projectRunPresentation(run)} agent={run.agent} />
          </li>)}</ul> : "No active agents" : metadata.agents.state === "loading" ? "Loading agents…"
          : metadata.agents.state === "unavailable" ? "Agents unavailable" : "Agent count unknown"}
      </dd></div>
    </dl>
    {metadata.error ? <div role="alert" className="mt-5 break-words text-lifecycle-danger">{metadata.error}
      <button type="button" aria-label="Retry module details" onClick={() => { void metadata.retry(); }} className="mt-2 block px-2 py-1 underline focus-visible:outline focus-visible:outline-focus-accent">Retry</button>
    </div> : null}
  </section>;
}
