import { useShallow } from "zustand/react/shallow";

import { LifecycleBadge } from "../terminal/LifecycleBadge";
import {
  MODULE_LIFECYCLE_STATES,
  selectModuleLifecycleCounts,
} from "./selectors";
import { useAgentStatusStore } from "./store";

export function ModuleLifecycleChicklets({ moduleId }: { moduleId: string }) {
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
