import type { ModuleJumpBadgePresentation } from "./useModuleJumpBadges";

export function ModuleJumpBadge({
  badge,
}: {
  badge: ModuleJumpBadgePresentation;
}) {
  return (
    <span
      aria-hidden="true"
      data-module-jump-position={badge.position}
      data-testid="module-jump-badge"
      className="pointer-events-none absolute top-1/2 right-1 inline-flex -translate-y-1/2 select-none items-center border border-pane-border bg-pane-bg px-1 font-mono text-[10px] font-normal leading-4 text-text-muted"
    >
      {badge.label}
    </span>
  );
}
