/**
 * The height the open panel is showing right now (#726).
 *
 * An ordinary panel renders the height the person chose, and that is a fact
 * about the store alone. A maximized panel renders the geometry policy's
 * current upper bound, which is a fact about the window — so this is where the
 * two meet: resizing the window recomputes the maximized panel's height while
 * the ordinary preference underneath it is left exactly as it was.
 */

import { useEffect, useReducer } from "react";

import { panelDisplayHeight } from "./panelGeometry";
import { useTerminalPanelStore } from "./panelStore";

export function usePanelDisplayHeight(): number {
  const height = useTerminalPanelStore((state) => state.height);
  const maximized = useTerminalPanelStore((state) => state.maximized);
  // Only the window's own size is missing from the store, and only a maximized
  // panel reads it, so one re-render per resize is enough to re-derive the
  // height from the geometry policy.
  const [, viewportChanged] = useReducer((tick: number) => tick + 1, 0);

  useEffect(() => {
    if (!maximized) return;
    window.addEventListener("resize", viewportChanged);
    return () => window.removeEventListener("resize", viewportChanged);
  }, [maximized, viewportChanged]);

  return panelDisplayHeight({ height, maximized });
}
