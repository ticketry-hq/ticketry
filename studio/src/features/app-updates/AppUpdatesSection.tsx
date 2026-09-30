import {
  SETTINGS_SECTION_HEADING_CLASS,
  settingsButtonClass,
} from "../../shared/ui/SettingsPrimitives";
import { UpdateDownloadProgress } from "./UpdateDownloadProgress";
import { useAppUpdates } from "./useAppUpdates";

function AppUpdatesHeading() {
  return (
    <h2 id="app-updates-heading" className={SETTINGS_SECTION_HEADING_CLASS}>
      App updates
    </h2>
  );
}

export function AppUpdatesSection() {
  const updates = useAppUpdates();
  const update = updates.update;

  if (!updates.available) {
    return (
      <section aria-labelledby="app-updates-heading">
        <AppUpdatesHeading />
        <p className="mt-1 text-sm text-text-muted">
          Updates are managed by the desktop app.
        </p>
      </section>
    );
  }

  const checking = update.status === "checking";
  const failedCheck =
    update.status === "failed" && update.retryTarget === "check";
  const failedInstall =
    update.status === "failed" && update.retryTarget === "install";
  // While an update is being applied or is waiting to relaunch, checking again
  // would contact the feed for a release the user already committed to.
  const applying =
    update.status === "downloading" || update.status === "restart-requested";

  return (
    <section aria-labelledby="app-updates-heading">
      <AppUpdatesHeading />
      <p className="mt-1 text-sm text-text-muted">
        Installed version {updates.installedVersion}
      </p>
      {update.status === "current" ? (
        <p role="status" className="mt-4 text-sm text-lifecycle-success">
          Ticketry is up to date
        </p>
      ) : null}
      {update.status === "available" || failedInstall ? (
        <div role="status" className="mt-4">
          <p className="text-sm font-semibold text-lifecycle-attention">
            {update.availableVersion
              ? `Version ${update.availableVersion} available`
              : "An update is available"}
          </p>
          {update.notes ? (
            <p className="mt-2 whitespace-pre-wrap text-sm text-text-secondary">
              {update.notes}
            </p>
          ) : null}
        </div>
      ) : null}
      {update.status === "downloading" ? (
        <UpdateDownloadProgress progress={update.progress} />
      ) : null}
      {update.status === "restart-requested" ? (
        <p role="status" className="mt-4 text-sm text-text-secondary">
          Restarting into version {update.availableVersion}
        </p>
      ) : null}
      {failedCheck ? (
        <p
          role="alert"
          className="mt-4 border-l-2 border-lifecycle-danger bg-lifecycle-danger/10 px-3 py-2 text-sm text-lifecycle-danger"
        >
          {update.failureKind === "signature-rejected"
            ? update.message
            : `Could not check for updates. ${update.message} Try again.`}
        </p>
      ) : null}
      {failedInstall ? (
        <p
          role="alert"
          className="mt-4 border-l-2 border-lifecycle-danger bg-lifecycle-danger/10 px-3 py-2 text-sm text-lifecycle-danger"
        >
          Could not install the update. {update.message} Try again.
        </p>
      ) : null}
      <div className="mt-4 flex items-center gap-2">
        {update.status === "available" || failedInstall ? (
          <button
            type="button"
            onClick={() => void updates.installAndRestart()}
            className={settingsButtonClass("primary")}
          >
            {failedInstall ? "Retry update" : "Update and restart"}
          </button>
        ) : null}
        {applying ? null : (
          <button
            type="button"
            disabled={checking}
            onClick={() => void updates.check()}
            className={settingsButtonClass("secondary")}
          >
            {checking
              ? "Checking for updates"
              : failedCheck
                ? "Retry update check"
                : "Check for updates"}
          </button>
        )}
      </div>
    </section>
  );
}
