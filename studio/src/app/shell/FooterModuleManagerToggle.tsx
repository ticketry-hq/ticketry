import { useModulesQuery, useStudioStore } from "../../features/projects";
import { useAgentStatusSelection, isAgentlessRun, selectRunState, toAgentLifecycle } from "../../features/agents/status";
import { IconLayoutGrid } from "../../shared/ui/icons";
import { KeyBadge } from "../../shared/ui/KeyChordHint";
import { useGlobalShortcutLabel } from "../navigation/useGlobalShortcutLabel";
import { toggleModuleManager, useModuleManagerStore } from "../../features/module-manager/state";

export function FooterModuleManagerToggle() {
  const projectId = useStudioStore((state) => state.selectedProjectId);
  const modules = useModulesQuery(projectId).data ?? [];
  const active = useModuleManagerStore((state) => state.active);
  const shortcut = useGlobalShortcutLabel("toggle-module-manager");
  const moduleIds = new Set(modules.filter((module) => !module.is_archived).map((module) => module.id));
  const attention = useAgentStatusSelection((holding) => Object.values(holding.runs).some((run) =>
    !isAgentlessRun(run) && run.module_id !== null && moduleIds.has(run.module_id)
    && toAgentLifecycle(selectRunState(holding, run.agent_run_id)) === "attention"));
  const label = active ? "Close Module Manager" : "Open Module Manager";

  return <button type="button" data-module-manager-toggle data-workspace-takeover-toggle data-coach-anchor="module-manager" aria-label={label}
    aria-expanded={active} aria-pressed={active} onClick={toggleModuleManager}
    className={`flex w-fit items-center gap-1 px-1.5 py-0.5 hover:bg-pane-bg hover:text-text-primary focus-visible:ring-1 focus-visible:ring-focus-accent ${active ? "bg-selection-bg text-text-primary" : "text-text-muted"}`}>
    <IconLayoutGrid size={14} /><span>Modules</span><span aria-label={`${moduleIds.size} active modules`}>{moduleIds.size}</span>
    {attention ? <span aria-label="Modules need attention" className="text-[8px] leading-none text-lifecycle-attention">●</span> : null}
    {shortcut ? <KeyBadge>{shortcut}</KeyBadge> : null}
  </button>;
}
