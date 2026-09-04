import { useState } from "react";

import { useClientStore } from "../../state/clientStore";
import { IconPlay, IconSettings } from "../../shared/ui/icons";
import { useModalStore } from "../../app/modal/modalStore";
import { useStudioStore } from "../projects";
import { useConfig, getModuleFolder } from "../studio/stores/configStore";
import { useTerminalStore } from "../agents/terminal";
import { useTerminalPanelStore } from "../terminal-panel";
import { startAppRun, stopAppRun } from "./api/appRunApi";
import { useModuleAppRun } from "./useModuleAppRun";

export const NO_MODULE_FOLDER_RUN_LABEL =
  "Choose a module folder before running this app";

export function FooterRunControl() {
  const moduleId = useClientStore((state) => state.selectedModuleId);
  const projectId = useStudioStore((state) => state.selectedProjectId);
  const config = useConfig();
  const profile =
    config.recentProfileIndex === null
      ? null
      : config.profiles[config.recentProfileIndex] ?? null;
  const folder = moduleId ? getModuleFolder(profile, moduleId) : undefined;
  const run = useModuleAppRun(moduleId);
  const pushModal = useModalStore((state) => state.pushModal);
  const [busy, setBusy] = useState(false);

  const configure = () => {
    if (!moduleId) return;
    pushModal({ type: "run-configuration", payload: { moduleId } });
  };

  const focus = (runId: string) => {
    if (!moduleId || !projectId) return;
    useTerminalStore.getState().openAppRunSession({ moduleId, projectId, runId });
    useTerminalPanelStore.getState().showAppRun(moduleId);
    useClientStore.getState().setEditViewZone("terminal-panel");
  };

  const activate = async () => {
    if (!moduleId || !folder || busy) return;
    if (!run.configuration) {
      configure();
      return;
    }
    if (run.live && run.runId) {
      focus(run.runId);
      return;
    }
    setBusy(true);
    try {
      const started = await startAppRun(moduleId);
      focus(started.runId);
      await run.refetch();
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!moduleId || busy) return;
    setBusy(true);
    try {
      await stopAppRun(moduleId);
      if (run.runId) {
        const sessionId = useTerminalStore.getState().sessionByRun[run.runId];
        if (sessionId) {
          useTerminalStore.getState().closeTab(sessionId, { dismiss: false });
        }
      }
      await run.refetch();
    } finally {
      setBusy(false);
    }
  };

  const unavailable = !moduleId || !folder;
  const label = unavailable
    ? NO_MODULE_FOLDER_RUN_LABEL
    : run.live
      ? "Focus running app"
      : run.configuration
        ? "Run app"
        : "Configure app run";

  return (
    <div className="flex items-center" data-testid="footer-run-control">
      <button
        type="button"
        data-testid="footer-run-primary"
        aria-label={label}
        title={label}
        disabled={unavailable || busy || run.loading}
        onClick={() => void activate()}
        className="flex items-center gap-1 px-1.5 py-0.5 text-text-muted hover:bg-pane-bg hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <IconPlay size={14} />
        <span>{run.live ? "Running" : "Run"}</span>
      </button>
      {run.live ? (
        <button
          type="button"
          data-testid="footer-run-stop"
          aria-label="Stop app run"
          disabled={busy}
          onClick={() => void stop()}
          className="px-1.5 py-0.5 text-text-muted hover:bg-pane-bg hover:text-text-primary"
        >
          Stop
        </button>
      ) : null}
      <button
        type="button"
        data-testid="footer-run-configure"
        aria-label="Configure app run"
        title="Configure app run"
        disabled={!moduleId}
        onClick={configure}
        className="px-1 py-0.5 text-text-muted hover:bg-pane-bg hover:text-text-primary disabled:opacity-50"
      >
        <IconSettings size={12} />
      </button>
    </div>
  );
}
