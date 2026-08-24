import { rightDockRegistry } from "./registry";
import { useRightDockStore } from "./rightDockStore";
import { useRightDockContext } from "./useRightDockContext";

export function RightDockFooterToggles() {
  const context = useRightDockContext();
  const open = useRightDockStore((state) => state.open);
  const selectedViewId = useRightDockStore((state) => state.selectedViewId);
  const toggleView = useRightDockStore((state) => state.toggleView);

  return rightDockRegistry.map((view) => {
    const available = view.isAvailable(context);
    const visible = open && selectedViewId === view.id && available;
    const label = available
      ? visible
        ? `Close ${view.label} dock`
        : `Open ${view.label} dock`
      : `Select a module to open ${view.label}`;
    const ViewIcon = view.icon;

    return (
      <button
        key={view.id}
        type="button"
        data-testid={`footer-${view.id}-toggle`}
        aria-label={label}
        title={label}
        aria-expanded={visible}
        disabled={!available}
        onClick={() => toggleView(view.id, available)}
        className="flex items-center gap-1 px-1.5 py-0.5 text-text-muted hover:bg-pane-bg hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-text-muted"
      >
        <ViewIcon size={14} />
        <span>{view.label}</span>
      </button>
    );
  });
}
