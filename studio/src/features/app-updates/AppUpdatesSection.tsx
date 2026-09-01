import {
  SETTINGS_SECTION_HEADING_CLASS,
  settingsButtonClass,
} from "../../shared/ui/SettingsPrimitives";
import type { DownloadProgress } from "./internal/updateMachine";
import { useAppUpdates } from "./useAppUpdates";

function bytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`;
  return `${(value / 1_048_576).toFixed(1)} MB`;
}

function progressCopy(progress: DownloadProgress): string {
  if (progress.totalBytes === null || progress.percent === null) {
    return `Downloaded ${bytes(progress.receivedBytes)}`;
  }
  return `Downloaded ${bytes(progress.receivedBytes)} of ${bytes(progress.totalBytes)} (${Math.round(progress.percent)}%)`;
}

export function AppUpdatesSection() {
  const updates = useAppUpdates();
  const { state } = updates;

  if (!updates.available) {
    return (
      <section aria-labelledby="app-updates-heading">
        <h2
          id="app-updates-heading"
          className={SETTINGS_SECTION_HEADING_CLASS}
        >
          App updates
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          Updates are managed by the desktop app.
        </p>
      </section>
    );
  }

  const hasRelease = "availableVersion" in state &&
    typeof state.availableVersion === "string";

  return (
    <section aria-labelledby="app-updates-heading">
      <h2
        id="app-updates-heading"
        className={SETTINGS_SECTION_HEADING_CLASS}
      >
        App updates
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        Installed version {updates.installedVersion}
      </p>

      {state.status === "current" ? (
        <p role="status" className="mt-4 text-sm text-lifecycle-success">
          Ticketry is up to date
        </p>
      ) : null}

      {hasRelease ? (
        <div role="status" className="mt-4">
          <p className="text-sm font-semibold text-lifecycle-attention">
            Version {state.availableVersion} available
          </p>
          {state.notes ? (
            <p className="mt-2 whitespace-pre-wrap text-sm text-text-secondary">
              {state.notes}
            </p>
          ) : null}
        </div>
      ) : null}

      {state.status === "downloading" ? (
        <div className="mt-4">
          <progress
            aria-label="Update download progress"
            className="h-2 w-full accent-accent"
            max={100}
            value={state.progress.percent ?? undefined}
          />
          <p className="mt-1 text-sm text-text-secondary">
            {progressCopy(state.progress)}
          </p>
        </div>
      ) : null}

      {state.status === "installing" ? (
        <p role="status" className="mt-4 text-sm text-text-secondary">
          Installing update
        </p>
      ) : null}

      {state.status === "restart-requested" ? (
        <p role="status" className="mt-4 text-sm text-text-secondary">
          Restart requested
        </p>
      ) : null}

      {state.status === "failed" ? (
        <p
          role="alert"
          className="mt-4 border-l-2 border-lifecycle-danger bg-lifecycle-danger/10 px-3 py-2 text-sm text-lifecycle-danger"
        >
          {state.retryTarget === "check" &&
          state.failureKind !== "signature-rejected"
            ? "Could not check for updates. "
            : null}
          {state.message}{" "}
          {state.failureKind === "signature-rejected"
            ? "Restore a trusted update feed, then retry."
            : "Try again."}
        </p>
      ) : null}

      {state.status === "ready-to-install" ? (
        <button
          type="button"
          onClick={() => void updates.updateAndRestart()}
          className={settingsButtonClass("primary", "mt-4")}
        >
          Update and restart
        </button>
      ) : null}

      {state.status === "failed" ? (
        <button
          type="button"
          onClick={() => void updates.retry()}
          className={settingsButtonClass("secondary", "mt-4")}
        >
          {state.retryTarget === "check"
            ? "Retry update check"
            : "Retry update"}
        </button>
      ) : null}

      {state.status === "idle" ||
      state.status === "checking" ||
      state.status === "current" ? (
        <button
          type="button"
          disabled={state.status === "checking"}
          onClick={() => void updates.check()}
          className={settingsButtonClass("secondary", "mt-4")}
        >
          {state.status === "checking"
            ? "Checking for updates"
            : "Check for updates"}
        </button>
      ) : null}
    </section>
  );
}
