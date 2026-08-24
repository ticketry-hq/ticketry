import { rightDockRegistry } from "./registry";
import { useRightDockStore } from "./rightDockStore";
import { useRightDockContext } from "./useRightDockContext";

export function useActiveRightDockView() {
  const context = useRightDockContext();
  const open = useRightDockStore((state) => state.open);
  const selectedViewId = useRightDockStore((state) => state.selectedViewId);
  const selectedView = rightDockRegistry.find(
    (registration) => registration.id === selectedViewId,
  );
  const available = Boolean(selectedView?.isAvailable(context));

  return {
    context,
    open,
    selectedView,
    available,
    activeView: open && available ? selectedView : undefined,
  };
}
