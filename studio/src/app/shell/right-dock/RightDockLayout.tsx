import { useEffect, type ReactNode } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";
import { PaneResizeHandle } from "../layout/PaneResizeHandle";
import { RightDock } from "./RightDock";
import {
  RIGHT_DOCK_MAX_WIDTH,
  RIGHT_DOCK_MIN_WIDTH,
  useRightDockStore,
} from "./rightDockStore";
import { useActiveRightDockView } from "./useActiveRightDockView";

export function RightDockLayout({ children }: { children: ReactNode }) {
  const { context, open, selectedView, available, activeView } =
    useActiveRightDockView();
  const width = useRightDockStore((state) => state.width);
  const close = useRightDockStore((state) => state.close);
  const setWidth = useRightDockStore((state) => state.setWidth);

  useEffect(() => {
    if (open && selectedView && !available) close();
  }, [available, close, open, selectedView]);

  return (
    <PanelGroup
      direction="horizontal"
      className="h-full w-full"
      onLayout={(sizes) => {
        if (activeView && sizes.length === 2) setWidth(sizes[1]);
      }}
    >
      <Panel
        data-testid="main-workspace-column"
        defaultSize={activeView ? 100 - width : 100}
        minSize={100 - RIGHT_DOCK_MAX_WIDTH}
        order={1}
      >
        {children}
      </Panel>
      {activeView ? (
        <>
          <PaneResizeHandle
            ariaLabel="Resize right dock"
            testId="right-dock-resize-handle"
          />
          <Panel
            defaultSize={width}
            minSize={RIGHT_DOCK_MIN_WIDTH}
            maxSize={RIGHT_DOCK_MAX_WIDTH}
            order={2}
          >
            <RightDock context={context} view={activeView} />
          </Panel>
        </>
      ) : null}
    </PanelGroup>
  );
}
