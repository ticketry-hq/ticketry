import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppUpdatesLaunchCheck,
  AppUpdatesSection,
} from "../features/app-updates";
import { StudioFooterActions } from "../app/shell/StudioFooterActions";
import { SettingsModal } from "../features/studio/modals/SettingsModal";
import { AppUpdateOperationError } from "../runtime";
import type {
  AppUpdateCheckResult,
  AppUpdateProgress,
  AppUpdateProgressListener,
} from "../runtime";

/**
 * The App updates state matrix, driven through the real Settings UI against a
 * scriptable runtime.
 *
 * The runtime contract is the seam these cases own: the desktop/browser split
 * means every update capability arrives through `StudioRuntime`, so no case
 * reaches into Tauri. Deferred check and install promises let each state be
 * held open and asserted rather than raced.
 */
const runtime = vi.hoisted(() => {
  const progressListeners = new Set<(progress: unknown) => void>();
  return {
    progressListeners,
    capabilities: { appUpdates: true },
    appUpdates: {
      check: vi.fn(),
      downloadAndInstall: vi.fn(),
      restart: vi.fn(),
      subscribeProgress: vi.fn((listener: (progress: unknown) => void) => {
        progressListeners.add(listener);
        return () => progressListeners.delete(listener);
      }),
    },
  };
});

vi.mock("../runtime", async () => ({
  ...(await vi.importActual<typeof import("../runtime")>("../runtime")),
  studioRuntime: () => runtime,
}));

vi.mock("../features/workflows", () => ({
  ModelConfigurationPanel: () => null,
}));

const AVAILABLE_RELEASE: AppUpdateCheckResult = {
  installedVersion: "0.2.0",
  status: "available",
  availableVersion: "0.3.0",
  notes: "Faster startup and clearer launch errors.",
};

function reportProgress(progress: AppUpdateProgress): void {
  act(() => {
    for (const listener of runtime.progressListeners) {
      (listener as AppUpdateProgressListener)(progress);
    }
  });
}

/** A promise this test resolves or rejects when it wants the state to move. */
function deferred<T>() {
  let settle!: (value: T) => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle, fail };
}

async function checkForUpdates(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
  expect(await screen.findByRole("button", { name: /update/i })).toBeEnabled();
}

describe("overhaul acceptance - app updates", () => {
  beforeEach(() => {
    runtime.capabilities.appUpdates = true;
    runtime.progressListeners.clear();
    runtime.appUpdates.check.mockReset();
    runtime.appUpdates.downloadAndInstall.mockReset();
    runtime.appUpdates.restart.mockReset();
    runtime.appUpdates.subscribeProgress.mockClear();
  });

  it("[overhaul-209] 1. reports no update with the installed version", async () => {
    const check = deferred<AppUpdateCheckResult>();
    runtime.appUpdates.check.mockReturnValue(check.promise);
    render(<AppUpdatesSection />);

    expect(screen.getByText("Installed version 0.2.0")).toBeInTheDocument();
    expect(runtime.appUpdates.check).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(
      screen.getByRole("button", { name: "Checking for updates" }),
    ).toBeDisabled();
    expect(runtime.appUpdates.check).toHaveBeenCalledOnce();

    check.settle({ installedVersion: "0.2.0", status: "current" });

    expect(
      await screen.findByText("Ticketry is up to date"),
    ).toBeInTheDocument();
    expect(screen.getByText("Installed version 0.2.0")).toBeInTheDocument();
    // Checking never downloads.
    expect(runtime.appUpdates.downloadAndInstall).not.toHaveBeenCalled();
  });

  it("[overhaul-210] 2. offers an available version and its notes without installing", async () => {
    runtime.appUpdates.check.mockResolvedValue(AVAILABLE_RELEASE);
    render(<AppUpdatesSection />);

    await checkForUpdates();

    expect(screen.getByText("Version 0.3.0 available")).toBeInTheDocument();
    expect(
      screen.getByText("Faster startup and clearer launch errors."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Update and restart" }),
    ).toBeEnabled();
    expect(runtime.appUpdates.downloadAndInstall).not.toHaveBeenCalled();
    expect(runtime.appUpdates.restart).not.toHaveBeenCalled();
  });

  it("[overhaul-211] 3. advances download progress, including an unknown total", async () => {
    const install = deferred<void>();
    runtime.appUpdates.check.mockResolvedValue(AVAILABLE_RELEASE);
    runtime.appUpdates.downloadAndInstall.mockReturnValue(install.promise);
    render(<AppUpdatesSection />);
    await checkForUpdates();

    fireEvent.click(screen.getByRole("button", { name: "Update and restart" }));

    // An update the user is applying cannot be re-checked underneath them.
    expect(
      screen.queryByRole("button", { name: /check for updates/i }),
    ).not.toBeInTheDocument();

    // A feed that declares no total leaves the download indeterminate.
    reportProgress({ receivedBytes: 2_000_000 });
    const progress = screen.getByRole("progressbar", {
      name: "Update download progress",
    });
    expect(progress).not.toHaveAttribute("aria-valuenow");
    expect(progress).toHaveAttribute("aria-valuetext", "2.0 MB downloaded");

    reportProgress({ receivedBytes: 2_000_000, totalBytes: 8_000_000 });
    expect(progress).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText(/Downloading update — 25%/)).toBeInTheDocument();

    reportProgress({ receivedBytes: 8_000_000, totalBytes: 8_000_000 });
    expect(progress).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText(/Installing update — 100%/)).toBeInTheDocument();
    expect(runtime.appUpdates.restart).not.toHaveBeenCalled();

    install.settle();
    await vi.waitFor(() => {
      expect(runtime.appUpdates.restart).toHaveBeenCalledOnce();
    });
  });

  it("[overhaul-212] 4a. turns an unreachable feed into a retry that succeeds", async () => {
    runtime.appUpdates.check
      .mockRejectedValueOnce(new Error("The update feed could not be reached."))
      .mockResolvedValueOnce({ installedVersion: "0.2.0", status: "current" });
    render(<AppUpdatesSection />);

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not check for updates. The update feed could not be reached. Try again.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry update check" }));

    expect(
      await screen.findByText("Ticketry is up to date"),
    ).toBeInTheDocument();
    expect(runtime.appUpdates.check).toHaveBeenCalledTimes(2);
  });

  it("[overhaul-213] 4b. refuses an invalid signature without requesting a restart", async () => {
    runtime.appUpdates.check.mockResolvedValue(AVAILABLE_RELEASE);
    runtime.appUpdates.downloadAndInstall.mockRejectedValue(
      new AppUpdateOperationError(
        "update_signature_invalid",
        "Update rejected: invalid signature. Ticketry was not changed.",
        false,
      ),
    );
    render(<AppUpdatesSection />);
    await checkForUpdates();

    fireEvent.click(screen.getByRole("button", { name: "Update and restart" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Update rejected: invalid signature. Ticketry was not changed.",
    );
    expect(runtime.appUpdates.restart).not.toHaveBeenCalled();
    // A rejected archive is discarded, so the only way forward is a new check.
    expect(
      screen.queryByRole("button", { name: /^Retry update$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry update check" }),
    ).toBeEnabled();
  });

  it("[overhaul-214] 4c. keeps a failed download retryable against the same release", async () => {
    runtime.appUpdates.check.mockResolvedValue(AVAILABLE_RELEASE);
    runtime.appUpdates.downloadAndInstall
      .mockRejectedValueOnce(
        new AppUpdateOperationError(
          "update_download_failed",
          "The update download did not finish.",
          true,
        ),
      )
      .mockResolvedValueOnce(undefined);
    runtime.appUpdates.restart.mockResolvedValue(undefined);
    render(<AppUpdatesSection />);
    await checkForUpdates();

    fireEvent.click(screen.getByRole("button", { name: "Update and restart" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not install the update. The update download did not finish. Try again.",
    );
    expect(screen.getByText("Version 0.3.0 available")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry update" }));

    await vi.waitFor(() => {
      expect(runtime.appUpdates.restart).toHaveBeenCalledOnce();
    });
    expect(runtime.appUpdates.downloadAndInstall).toHaveBeenCalledTimes(2);
    expect(runtime.appUpdates.check).toHaveBeenCalledOnce();
  });

  it("[overhaul-215] 5. restarts exactly once, only after installation completes", async () => {
    const install = deferred<void>();
    runtime.appUpdates.check.mockResolvedValue(AVAILABLE_RELEASE);
    runtime.appUpdates.downloadAndInstall.mockReturnValue(install.promise);
    runtime.appUpdates.restart.mockResolvedValue(undefined);
    render(<AppUpdatesSection />);
    await checkForUpdates();

    fireEvent.click(screen.getByRole("button", { name: "Update and restart" }));
    expect(runtime.appUpdates.downloadAndInstall).toHaveBeenCalledOnce();
    expect(runtime.appUpdates.restart).not.toHaveBeenCalled();

    install.settle();
    await vi.waitFor(() => {
      expect(runtime.appUpdates.restart).toHaveBeenCalledOnce();
    });

    expect(
      screen.getByText("Restarting into version 0.3.0"),
    ).toBeInTheDocument();
    // Late progress from the finished download cannot restart the app again.
    reportProgress({ receivedBytes: 8_000_000, totalBytes: 8_000_000 });
    expect(runtime.appUpdates.restart).toHaveBeenCalledOnce();
    expect(runtime.appUpdates.subscribeProgress).toHaveBeenCalledOnce();
    expect(runtime.progressListeners.size).toBe(0);
  });

  it("[overhaul-216] checks once on desktop launch and shares the result with Settings", async () => {
    runtime.appUpdates.check.mockResolvedValue(AVAILABLE_RELEASE);

    render(
      <StrictMode>
        <AppUpdatesLaunchCheck />
        <StudioFooterActions />
        <SettingsModal />
      </StrictMode>,
    );

    expect(
      await screen.findByRole("button", {
        name: "Open Settings",
        description: "Update available",
      }),
    ).toBeInTheDocument();
    expect(runtime.appUpdates.check).toHaveBeenCalledOnce();
    expect(runtime.appUpdates.downloadAndInstall).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("tab", {
        name: "App updates",
        description: "Update available",
      }),
    );

    expect(screen.getByText("Version 0.3.0 available")).toBeInTheDocument();
    expect(
      screen.getByText("Faster startup and clearer launch errors."),
    ).toBeInTheDocument();
    // Opening the section must not contact the feed a second time.
    expect(runtime.appUpdates.check).toHaveBeenCalledOnce();
  });

  it("[overhaul-208] keeps a failed launch check quiet until App updates opens", async () => {
    runtime.appUpdates.check.mockRejectedValue(
      new Error("The update feed could not be reached."),
    );

    render(
      <StrictMode>
        <AppUpdatesLaunchCheck />
        <StudioFooterActions />
        <SettingsModal />
      </StrictMode>,
    );

    await vi.waitFor(() => {
      expect(runtime.appUpdates.check).toHaveBeenCalledOnce();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Open Settings",
        description: "Update available",
      }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "App updates" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not check for updates. The update feed could not be reached. Try again.",
    );
    expect(runtime.appUpdates.check).toHaveBeenCalledOnce();
  });

  it("[overhaul-206] quietly defers browser updates to the desktop app without checking", () => {
    runtime.capabilities.appUpdates = false;

    render(
      <StrictMode>
        <AppUpdatesLaunchCheck />
        <AppUpdatesSection />
      </StrictMode>,
    );

    expect(
      screen.getByText("Updates are managed by the desktop app."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /update/i }),
    ).not.toBeInTheDocument();
    expect(runtime.appUpdates.check).not.toHaveBeenCalled();
  });
});
