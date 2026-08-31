import {
  SETTINGS_SECTION_HEADING_CLASS,
  settingsButtonClass,
} from "../../shared/ui/SettingsPrimitives";
import { useAppUpdates } from "./useAppUpdates";

export function AppUpdatesSection() {
  const updates = useAppUpdates();

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
      {updates.status === "current" ? (
        <p role="status" className="mt-4 text-sm text-lifecycle-success">
          Ticketry is up to date
        </p>
      ) : null}
      {updates.status === "available" ? (
        <div role="status" className="mt-4">
          <p className="text-sm font-semibold text-lifecycle-attention">
            {updates.availableVersion
              ? `Version ${updates.availableVersion} available`
              : "An update is available"}
          </p>
          {updates.notes ? (
            <p className="mt-2 whitespace-pre-wrap text-sm text-text-secondary">
              {updates.notes}
            </p>
          ) : null}
        </div>
      ) : null}
      {updates.status === "failed" ? (
        <p
          role="alert"
          className="mt-4 border-l-2 border-lifecycle-danger bg-lifecycle-danger/10 px-3 py-2 text-sm text-lifecycle-danger"
        >
          Could not check for updates. {updates.errorMessage} Try again.
        </p>
      ) : null}
      <button
        type="button"
        disabled={updates.status === "checking"}
        onClick={() => void updates.check()}
        className={settingsButtonClass("secondary", "mt-4")}
      >
        {updates.status === "checking"
          ? "Checking for updates"
          : updates.status === "failed"
            ? "Retry update check"
            : "Check for updates"}
      </button>
    </section>
  );
}
