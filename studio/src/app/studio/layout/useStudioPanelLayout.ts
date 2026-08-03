import { useEffect, useRef } from "react";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import {
  isSidebarEnabled,
  sidebarPaneComposition,
  useConfig,
} from "../../../features/studio/stores/configStore";
import { useUIStore } from "../../../features/studio/stores/uiStore";
import {
  DEFAULT_PANEL_LAYOUT,
  mergeOuterPanelLayout,
  mergeWorkAreaLayout,
  outerPanelLayout,
  splitWorkArea,
} from "./layoutMath";

export function useStudioPanelLayout() {
  const config = useConfig();
  const paneComposition = sidebarPaneComposition(
    config.features.projects,
    isSidebarEnabled(config),
  );
  const sidebarVisible = useUIStore((state) => state.sidebarVisible);
  const panelLayout = useUIStore((state) => state.panelLayout);
  const setPanelLayout = useUIStore((state) => state.setPanelLayout);

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
