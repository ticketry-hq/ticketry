import { useEffect, useRef } from "react";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import { useClientStore } from "../../../state/clientStore";
import {
  DEFAULT_SIDEBAR_PANE_COMPOSITION,
  DEFAULT_PANEL_LAYOUT,
  mergeOuterPanelLayout,
  mergeWorkAreaLayout,
  outerPanelLayout,
  splitWorkArea,
} from "./layoutMath";

export function useStudioPanelLayout() {
  const paneComposition = DEFAULT_SIDEBAR_PANE_COMPOSITION;
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
    outerGroupRef.current?.setLayout(
      outerPanelLayout(sizes, isSidebarVisible, paneComposition),
    );
    workAreaGroupRef.current?.setLayout(splitWorkArea(sizes));
  }

  useEffect(() => {
    previousSidebarVisible.current = sidebarVisible;
    applyLayout(panelLayout ?? DEFAULT_PANEL_LAYOUT, sidebarVisible);
  }, [sidebarVisible, panelLayout, paneComposition]);

  function handleOuterLayout(sizes: number[]) {
    if (skipNextOuterLayout.current) {
      skipNextOuterLayout.current = false;
      return;
    }

    if (!sidebarVisible || paneComposition === "absent") return;

    const nextLayout = mergeOuterPanelLayout(
      panelLayout ?? DEFAULT_PANEL_LAYOUT,
      sizes,
      paneComposition,
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
    paneComposition,
    sidebarVisible,
    outerGroupRef,
    workAreaGroupRef,
    handleOuterLayout,
    handleWorkAreaLayout,
  };
}
