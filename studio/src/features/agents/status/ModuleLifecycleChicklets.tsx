import { LifecycleBadge } from "../terminal/LifecycleBadge";
import { useModuleLifecycleCounts } from "./hooks";
import { MODULE_LIFECYCLE_STATES } from "./selectors";

export function ModuleLifecycleChicklets({ moduleId }: { moduleId: string }) {
  const counts = useModuleLifecycleCounts(moduleId);
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
