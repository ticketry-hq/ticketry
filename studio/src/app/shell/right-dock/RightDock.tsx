import { IconX } from "../../../shared/ui/icons";
import { useRightDockStore } from "./rightDockStore";
import type {
  RightDockContext,
  RightDockViewRegistration,
} from "./types";

interface RightDockProps {
  context: RightDockContext;
  view: RightDockViewRegistration;
}

export function RightDock({ context, view }: RightDockProps) {
  const close = useRightDockStore((state) => state.close);
  const ViewIcon = view.icon;

  return (
    <section
      aria-label={`${view.label} dock`}
      data-testid="right-dock"
      className="flex h-full min-w-0 flex-col border-l border-pane-border bg-pane-panel"
    >
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-pane-border bg-pane-title px-2 text-xs text-text-primary">
        <div className="flex min-w-0 items-center gap-1.5 font-medium">
          <ViewIcon size={14} />
          <span>{view.label}</span>
        </div>
        <button
          type="button"
          aria-label={`Close ${view.label} dock`}
          title={`Close ${view.label} dock`}
          onClick={close}
          className="p-1 text-text-muted hover:bg-pane-bg hover:text-text-primary focus-visible:ring-1 focus-visible:ring-focus-accent"
        >
          <IconX size={14} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{view.render(context)}</div>
    </section>
  );
}
