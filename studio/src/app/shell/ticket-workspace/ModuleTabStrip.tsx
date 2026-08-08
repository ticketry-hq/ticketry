import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useModalStore } from "../../modal/modalStore";
import {
  MODULE_LIFECYCLE_STATES,
  selectModuleLifecycleCounts,
  useAgentStatusStore,
} from "../../../features/agents/status";
import { LifecycleBadge } from "../../../features/agents/terminal";
import { useModulesQuery } from "../../../features/projects";
import { useStudioStore } from "../../../features/projects/store";
import { useClientStore } from "../../../state/clientStore";

function ModuleLifecycleChicklets({ moduleId }: { moduleId: string }) {
  const counts = useAgentStatusStore(
    useShallow((state) => selectModuleLifecycleCounts(state, moduleId)),
  );
  const visibleStates = MODULE_LIFECYCLE_STATES.filter(
    (state) => counts[state] > 0,
  );
  if (visibleStates.length === 0) return null;

  return (
    <span className="ml-2 inline-flex shrink-0 items-center gap-1">
      {visibleStates.map((state) => (
        <LifecycleBadge
          key={state}
          state={state}
          count={counts[state]}
          showLabel={false}
          alwaysShowCount
        />
      ))}
    </span>
  );
}

export function ModuleTabStrip() {
  const selectedProjectId = useStudioStore((state) => state.selectedProjectId);
  const modulesQuery = useModulesQuery(selectedProjectId);
  const modules = modulesQuery.data ?? [];
  const selectedModuleId = useClientStore((state) => state.selectedModuleId);
  const selectModule = useClientStore((state) => state.selectModule);
  const loading = modulesQuery.isPending;
  const pushModal = useModalStore((state) => state.pushModal);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (!selectedModuleId || loading) return;
    tabRefs.current[selectedModuleId]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [loading, selectedModuleId]);

  return (
    <div
      role="tablist"
      aria-label="Project modules"
      className="flex h-7 min-w-0 shrink-0 overflow-x-auto border-b border-pane-border bg-pane-title [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {!loading && modules.map((module) => (
        <button
          ref={(node) => {
            tabRefs.current[module.id] = node;
          }}
          key={module.id}
          type="button"
          role="tab"
          aria-label={module.name}
          aria-selected={module.id === selectedModuleId}
          tabIndex={-1}
          title={module.name}
          onClick={() => void selectModule(module.id)}
          className={`flex max-w-64 shrink-0 items-center border-r border-pane-border px-3 text-xs ${
            module.id === selectedModuleId
              ? "bg-pane-panel font-semibold text-text-primary shadow-[inset_0_-2px_0_0_#7aa2f7]"
              : "text-text-muted hover:bg-pane-panel hover:text-text-primary"
          }`}
        >
          <span className="truncate">{module.name}</span>
          <ModuleLifecycleChicklets moduleId={module.id} />
        </button>
      ))}
      {!loading && (
        <button
          type="button"
          aria-label="Add module"
          data-coach-anchor="module-add"
          onClick={() => pushModal({ type: "add-module" })}
          className="flex w-8 shrink-0 items-center justify-center border-r border-pane-border text-sm text-text-muted hover:bg-pane-panel hover:text-text-primary"
        >
          +
        </button>
      )}
    </div>
  );
}
