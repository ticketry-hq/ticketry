/**
 * The visible panel's header row (#725, #726).
 *
 * It carries the module's shell tabs on the leading edge and the panel's own
 * window furniture on the trailing edge. The two are deliberately separate:
 * the tab list keeps its own `tablist` semantics, and the furniture sits
 * outside it so assistive technology never announces a layout action as a
 * shell tab. The header shows even in the states that have no tab strip, so a
 * person can always minimize the panel they are looking at.
 */

import type { ReactNode } from "react";

import { MaximizePanelButton } from "./MaximizePanelButton";
import { MinimizePanelButton } from "./MinimizePanelButton";

export function PanelHeader({ children }: { children?: ReactNode }) {
  return (
    <div
      data-testid="terminal-panel-header"
      className="flex shrink-0 items-stretch border-b border-pane-border bg-pane-title text-xs"
    >
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {children}
      </div>
      <MaximizePanelButton />
      <MinimizePanelButton />
    </div>
  );
}
