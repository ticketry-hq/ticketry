import { useEffect, useRef } from "react";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import { useClientStore } from "../../../state/clientStore";
import { selectPlanWorkspaceActive, usePlanWorkspace } from "../../../features/sprints";
import { DEFAULT_PANEL_LAYOUT, splitWorkArea } from "./layoutMath";

export function useStudioPanelLayout(suspended = false) {
  const planActive = usePlanWorkspace(selectPlanWorkspaceActive);
  const panelLayout = useClientStore((state) => state.panelLayout);
  const setPanelLayout = useClientStore((state) => state.setPanelLayout);
  const workAreaGroupRef = useRef<ImperativePanelGroupHandle>(null);
  const layout = splitWorkArea(panelLayout ?? DEFAULT_PANEL_LAYOUT);

  useEffect(() => {
    if (suspended) return;
    // Retired sidebar slots never reserve width. Save their translated ratio
    // once so later launches and resizing use only Stories and the workspace.
    if (panelLayout && (panelLayout.length !== 2 || panelLayout.some((size, index) => Math.abs(size - layout[index]) > 0.000001))) {
      setPanelLayout(layout);
    }
    if (workAreaGroupRef.current?.getLayout().length === 2) {
      workAreaGroupRef.current.setLayout(layout);
    }
  }, [panelLayout, suspended, setPanelLayout]);

  function handleWorkAreaLayout(sizes: number[]) {
    if (planActive) return;
    if (sizes.length !== 2 || sizes.every((size, index) => Math.abs(size - layout[index]) < 0.000001)) return;
    setPanelLayout(sizes);
  }

  return { layout, workAreaGroupRef, handleWorkAreaLayout };
}
