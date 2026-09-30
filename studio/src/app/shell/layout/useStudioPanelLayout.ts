import { useEffect, useRef } from "react";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import { useClientStore } from "../../../state/clientStore";
import {
  DEFAULT_PANEL_LAYOUT,
  mergeOuterPanelLayout,
  mergeWorkAreaLayout,
  outerPanelLayout,
  splitWorkArea,
} from "./layoutMath";

export function useStudioPanelLayout(suspended = false) {
  const sidebarVisible = useClientStore((state) => state.sidebarVisible);
  const panelLayout = useClientStore((state) => state.panelLayout);
  const setPanelLayout = useClientStore((state) => state.setPanelLayout);

  const outerGroupRef = useRef<ImperativePanelGroupHandle>(null);
  const workAreaGroupRef = useRef<ImperativePanelGroupHandle>(null);
  const skipNextOuterLayout = useRef(true);
  const skipNextWorkAreaLayout = useRef(true);
  const previousSidebarVisible = useRef(sidebarVisible);

  // Showing the sidebar programmatically restores the outer panel layout.
  if (sidebarVisible && !previousSidebarVisible.current) {
    skipNextOuterLayout.current = true;
  }

  const layout = panelLayout ?? DEFAULT_PANEL_LAYOUT;

  function applyLayout(sizes: number[], isSidebarVisible: boolean) {
    skipNextOuterLayout.current = true;
    skipNextWorkAreaLayout.current = true;
    const outer = outerPanelLayout(sizes, isSidebarVisible);
    if (outerGroupRef.current?.getLayout().length === outer.length) {
      outerGroupRef.current.setLayout(outer);
    }
    const workArea = splitWorkArea(sizes);
    if (workAreaGroupRef.current?.getLayout().length === workArea.length) {
      workAreaGroupRef.current.setLayout(workArea);
    }
  }

  useEffect(() => {
    previousSidebarVisible.current = sidebarVisible;
    if (suspended) return;
    // A stable PanelGroup keeps the workspace mounted while the sidebar is
    // shown or hidden. Its imperative handle is available before conditional
    // Panels finish registering, so applyLayout checks the registered shape;
    // default sizes cover a commit whose shape is still changing.
    applyLayout(panelLayout ?? DEFAULT_PANEL_LAYOUT, sidebarVisible);
  }, [sidebarVisible, panelLayout, suspended]);

  function handleOuterLayout(sizes: number[]) {
    if (skipNextOuterLayout.current) {
      skipNextOuterLayout.current = false;
      return;
    }

    if (!sidebarVisible) return;

    const nextLayout = mergeOuterPanelLayout(
      panelLayout ?? DEFAULT_PANEL_LAYOUT,
      sizes,
    );
    if (nextLayout) setPanelLayout(nextLayout);
  }

  function handleWorkAreaLayout(sizes: number[]) {
    if (skipNextWorkAreaLayout.current) {
      skipNextWorkAreaLayout.current = false;
      return;
    }

    const nextLayout = mergeWorkAreaLayout(
      panelLayout ?? DEFAULT_PANEL_LAYOUT,
      sizes,
    );
    if (nextLayout) setPanelLayout(nextLayout);
  }

  return {
    layout,
    sidebarVisible,
    outerGroupRef,
    workAreaGroupRef,
    handleOuterLayout,
    handleWorkAreaLayout,
  };
}
