/**
 * The bottom terminal panel: plain login shells for the selected module
 * (#667, #668).
 *
 * It is a shell surface, not a dock. Agent runs keep their terminal tabs in the
 * task workspace and never appear here, so the live-terminal cycle, subtree
 * chicklets and per-work-item active-tab memory are untouched.
 *
 * Nothing below this component mounts while the panel is closed, and only the
 * active tab's terminal mounts while it is open. That is the lazy-attachment
 * guarantee: the durable tmux sessions live on regardless, so a background tab
 * and a closed panel both really do cost nothing.
 */

import { useEffect } from "react";
import type { ReactNode } from "react";

import { Terminal, useTerminalStore } from "../agents/terminal";
import { useStudioStore } from "../projects/store";
import { useClientStore } from "../../state/clientStore";
import { DeadShell } from "./DeadShell";
import { ModuleFolderRequired } from "./ModuleFolderRequired";
import { useModuleShellStore } from "./moduleShellStore";
import { usePanelDisplayHeight } from "./panelDisplayHeight";
import { PanelHeader } from "./PanelHeader";
import { PanelResizeGrip } from "./PanelResizeGrip";
import { useTerminalPanelOpen, useTerminalPanelStore } from "./panelStore";
import { useShellExitWatch } from "./shellExitWatch";
import { ShellTabStrip } from "./ShellTabStrip";
import { deadShell, EMPTY_SHELL_SET } from "./shellTabSet";

export function TerminalPanel() {
  // Showing is per module: entering a module that never opened the panel
  // arrives without one, and the module that did keeps it (#730).
  const open = useTerminalPanelOpen();
  // Maximized renders the geometry policy's current bound; ordinary renders the
  // person's own height. Hiding and reopening keeps whichever it was (#726).
  const height = usePanelDisplayHeight();
  if (!open) return null;
  return (
    <div
      data-testid="terminal-panel"
      // The visible panel is the edit view's fourth navigation zone. The typing
      // exit chord focuses this element, which leaves typing mode without
      // disturbing the panel itself (#669).
      data-navigation-zone="terminal-panel"
      tabIndex={-1}
      style={{ height }}
      className="flex shrink-0 flex-col border-t border-pane-border bg-pane-panel outline-none"
    >
      <PanelResizeGrip />
      <TerminalPanelBody />
    </div>
  );
}

function TerminalPanelBody() {
  const moduleId = useClientStore((state) => state.selectedModuleId);
  const projectId = useStudioStore((state) => state.selectedProjectId);
  const focusSignal = useTerminalPanelStore((state) => state.focusSignal);
  const shells = useModuleShellStore((state) =>
    moduleId ? state.byModule[moduleId] ?? EMPTY_SHELL_SET : EMPTY_SHELL_SET,
  );
  const openModule = useModuleShellStore((state) => state.openModule);
  const createShell = useModuleShellStore((state) => state.createShell);
  const closeShell = useModuleShellStore((state) => state.closeShell);
  const selectShell = useModuleShellStore((state) => state.selectShell);
  const retryShell = useModuleShellStore((state) => state.retryShell);
  const restartShell = useModuleShellStore((state) => state.restartShell);
  const sessionId = useTerminalStore((state) =>
    shells.activeRunId ? state.sessionByRun[shells.activeRunId] ?? null : null,
  );
  // The showing shell's own ending, if it had one. A dead shell keeps its tab,
  // so the body — not the strip — is where its outcome is read and undone.
  const dead = shells.activeRunId ? deadShell(shells, shells.activeRunId) : null;
  // A module that has been looked at and holds nothing is a different state
  // from one whose first shell is still on its way.
  const emptied =
    shells.discovered && !shells.busy && shells.runIds.length === 0;

  // Switching modules re-enters here with the new module's strip: its shells
  // are rediscovered once, and its remembered active tab comes back with them.
  useEffect(() => {
    if (!moduleId || !projectId) return;
    void openModule(moduleId, projectId);
  }, [openModule, moduleId, projectId]);

  // Endings come from the run projection, never from a viewer closing, so the
  // panel behaves the same under either renderer (#670).
  useShellExitWatch(moduleId);

  if (!moduleId || !projectId) {
    return (
      <PanelFrame>
        <div
          data-testid="terminal-panel-empty"
          className="flex h-full w-full items-center justify-center text-sm text-text-muted"
        >
          Select a module to open a shell.
        </div>
      </PanelFrame>
    );
  }

  if (shells.problem?.kind === "needs-folder") {
    return (
      <PanelFrame>
        <ModuleFolderRequired
          moduleId={moduleId}
          reason={shells.problem.reason}
          onLinked={() => void retryShell(moduleId, projectId)}
        />
      </PanelFrame>
    );
  }

  if (shells.problem?.kind === "failed") {
    return (
      <PanelFrame>
        <div
          data-testid="terminal-panel-failure"
          role="alert"
          className="flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center text-sm text-text-muted"
        >
          <p>Could not start a shell: {shells.problem.reason}</p>
          <button
            type="button"
            data-testid="terminal-panel-retry"
            onClick={() => void retryShell(moduleId, projectId)}
            className="border border-pane-border px-3 py-1 text-text-primary hover:bg-pane-title"
          >
            Try again
          </button>
        </div>
      </PanelFrame>
    );
  }

  return (
    <PanelFrame
      tabs={
        <ShellTabStrip
          shells={shells}
          onSelect={(runId) => selectShell(moduleId, runId)}
          onClose={(runId) => void closeShell(moduleId, runId)}
          onCreate={() => void createShell(moduleId, projectId)}
        />
      }
    >
      <>
        {dead ? (
          <DeadShell
            exitCode={dead.exitCode}
            busy={shells.busy}
            onRestart={() =>
              void restartShell(moduleId, projectId, shells.activeRunId!)
            }
          />
        ) : sessionId ? (
          // Keyed by session so the active tab's terminal is a distinct mount:
          // a switch detaches the outgoing shell rather than re-pointing one
          // viewer at a different durable run.
          <Terminal
            key={sessionId}
            sessionId={sessionId}
            owner="panel"
            focusSignal={focusSignal}
            active
          />
        ) : emptied ? (
          // Closing the last tab is the one way to reach a discovered module
          // with no shells. The strip is not re-populated behind the person who
          // emptied it, so the body has to say what happened and point at the
          // action that undoes it (#668).
          <div
            data-testid="terminal-panel-no-shells"
            className="flex h-full w-full items-center justify-center text-sm text-text-muted"
          >
            No shells in this module. Use + to start one.
          </div>
        ) : (
          <div
            data-testid="terminal-panel-pending"
            className="h-full w-full bg-pane-panel"
          />
        )}
      </>
    </PanelFrame>
  );
}

/**
 * The panel header over whatever the body is currently showing. Every body
 * state renders it, so the minimize control is available in the failure and
 * no-module states too.
 */
function PanelFrame({
  tabs,
  children,
}: {
  tabs?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <PanelHeader>{tabs}</PanelHeader>
      <div className="min-h-0 flex-1">{children}</div>
    </>
  );
}
