import type { EffectiveModuleTabs } from "./effectiveModuleTabs";
import { useModuleNavigation } from "./useModuleNavigation";

/** Presentation actions use the same eligibility projection as module tabs. */
export function ModulePresentationAction({ moduleId, projection }: {
  moduleId: string;
  projection: EffectiveModuleTabs;
}) {
  const { openModule, restoreAndSelectModule } = useModuleNavigation();
  const entry = projection.entries.find(({ module }) => module.id === moduleId);
  if (!entry || entry.status === "open" || entry.status === "archived") return null;
  const restore = entry.status === "hidden";
  const clearsFilter = projection.restricted && entry.sprintEligible === false;
  const label = (restore ? "Restore " : "Open ") + entry.module.name
    + (restore ? " module tab" : " module") + (clearsFilter ? "; clears sprint filter" : "");
  return <button type="button" aria-label={label} disabled={projection.loading}
    className="ml-auto shrink-0 px-1 text-xs text-text-muted hover:text-text-primary disabled:opacity-50"
    onClick={(event) => {
      event.stopPropagation();
      void (restore ? restoreAndSelectModule(moduleId) : openModule(moduleId));
    }}>
    {restore ? "Restore" : "Open"}{clearsFilter ? " · clears sprint filter" : ""}
  </button>;
}
