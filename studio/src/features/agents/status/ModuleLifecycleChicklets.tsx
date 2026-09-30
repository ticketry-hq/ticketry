import { LifecycleBadge } from "../terminal/LifecycleBadge";
import { useModuleLifecycleChips } from "./hooks";

export function ModuleLifecycleChicklets({ moduleId }: { moduleId: string }) {
  const chips = useModuleLifecycleChips(moduleId);
  if (chips.length === 0) return null;

  return (
    <span className="ml-2 inline-flex shrink-0 items-center gap-1">
      {chips.map((chip) => (
        <LifecycleBadge
          key={`${chip.state}|${chip.agent ?? ""}`}
          state={chip.state}
          agent={chip.agent}
          count={chip.count}
          showLabel={false}
          alwaysShowCount
        />
      ))}
    </span>
  );
}
