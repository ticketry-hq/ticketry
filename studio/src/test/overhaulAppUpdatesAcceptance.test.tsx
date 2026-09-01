import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppUpdatesLaunchCheck,
  AppUpdatesSection,
} from "../features/app-updates";
import { StudioFooterActions } from "../app/shell/StudioFooterActions";
import { SettingsModal } from "../features/studio/modals/SettingsModal";

const runtime = vi.hoisted(() => ({
  capabilities: { appUpdates: true },
  appUpdates: {
    check: vi.fn(),
    downloadAndInstall: vi.fn(),
    restart: vi.fn(),
    subscribeProgress: vi.fn<
      (
        listener: (progress: {
          receivedBytes: number;
          totalBytes?: number;
        }) => void,
      ) => () => void
    >(() => () => {}),
  },
}));
let progressListener:
  | ((progress: { receivedBytes: number; totalBytes?: number }) => void)
  | undefined;

vi.mock("../runtime", async () => ({
  ...(await vi.importActual<typeof import("../runtime")>("../runtime")),
  studioRuntime: () => runtime,
}));

vi.mock("../features/workflows", () => ({
  ModelConfigurationPanel: () => null,
}));

describe("overhaul acceptance - app updates", () => {
  beforeEach(() => {
    runtime.capabilities.appUpdates = true;
    runtime.appUpdates.check.mockReset();
    runtime.appUpdates.downloadAndInstall.mockReset();
    runtime.appUpdates.restart.mockReset();
    progressListener = undefined;
    runtime.appUpdates.subscribeProgress.mockReset();
    runtime.appUpdates.subscribeProgress.mockImplementation((listener) => {
      progressListener = listener;
      return () => {};
    });
  });

  it("checks once on desktop launch and shares an available update with Settings", async () => {
    runtime.appUpdates.check.mockResolvedValue({
      installedVersion: "0.2.0",
      status: "available",
      availableVersion: "0.3.0",
      notes: "Faster startup and clearer launch errors.",
    });

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

    const appUpdatesTab = screen.getByRole("tab", {
      name: "App updates",
      description: "Update available",
    });
    fireEvent.click(appUpdatesTab);

    expect(screen.getByText("Version 0.3.0 available")).toBeInTheDocument();
    expect(
      screen.getByText("Faster startup and clearer launch errors."),
    ).toBeInTheDocument();
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

  it("wires App updates into Settings with the installed version and an explicit check action", () => {
    render(<SettingsModal />);

    fireEvent.click(screen.getByRole("tab", { name: "App updates" }));

    expect(
      screen.getByRole("heading", { name: "App updates" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Installed version 0.2.0")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Check for updates" }),
    ).toBeEnabled();
    expect(runtime.appUpdates.check).not.toHaveBeenCalled();
  });

  it("shows checking and then reports that Ticketry is current", async () => {
    let finishCheck!: (result: {
      installedVersion: string;
      status: "current";
    }) => void;
    runtime.appUpdates.check.mockImplementation(
      () => new Promise((resolve) => {
        finishCheck = resolve;
      }),
    );
    render(<AppUpdatesSection />);

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));

    expect(
      screen.getByRole("button", { name: "Checking for updates" }),
    ).toBeDisabled();
    expect(runtime.appUpdates.check).toHaveBeenCalledOnce();

    finishCheck({ installedVersion: "0.2.0", status: "current" });

    expect(
      await screen.findByText("Ticketry is up to date"),
    ).toBeInTheDocument();
    expect(screen.getByText("Installed version 0.2.0")).toBeInTheDocument();
  });

  it("shows an available version with its update feed notes", async () => {
    runtime.appUpdates.check.mockResolvedValue({
      installedVersion: "0.2.0",
      status: "available",
      availableVersion: "0.3.0",
      notes: "Faster startup and clearer launch errors.",
    });
    render(<AppUpdatesSection />);

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));

    expect(await screen.findByText("Version 0.3.0 available"))
      .toBeInTheDocument();
    expect(
      screen.getByText("Faster startup and clearer launch errors."),
    ).toBeInTheDocument();
  });

  it("[overhaul-209] installs only after confirmation and requests restart only after installation", async () => {
    let finishInstall!: () => void;
    runtime.appUpdates.check.mockResolvedValue({
      installedVersion: "0.2.0",
      status: "available",
      availableVersion: "0.3.0",
    });
    runtime.appUpdates.downloadAndInstall.mockImplementation(
      () => new Promise<void>((resolve) => {
        finishInstall = resolve;
      }),
    );
    runtime.appUpdates.restart.mockResolvedValue(undefined);
    render(<AppUpdatesSection />);

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("Version 0.3.0 available"))
      .toBeInTheDocument();
    expect(runtime.appUpdates.downloadAndInstall).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Update and restart" }));
    expect(runtime.appUpdates.downloadAndInstall).toHaveBeenCalledOnce();
    expect(runtime.appUpdates.restart).not.toHaveBeenCalled();
    act(() => {
      progressListener?.({ receivedBytes: 256, totalBytes: 1_024 });
    });
    expect(
      screen.getByRole("progressbar", { name: "Update download progress" }),
    ).toHaveAttribute("value", "25");
    expect(screen.getByText("Downloaded 256 B of 1.0 KB (25%)"))
      .toBeInTheDocument();

    finishInstall();
    await vi.waitFor(() => {
      expect(runtime.appUpdates.restart).toHaveBeenCalledOnce();
    });
  });

  it("turns a failed update check into an actionable retry", async () => {
    runtime.appUpdates.check
      .mockRejectedValueOnce(new Error("The update feed could not be reached."))
      .mockResolvedValueOnce({
        installedVersion: "0.2.0",
        status: "current",
      });
    render(<AppUpdatesSection />);

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not check for updates. The update feed could not be reached. Try again.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry update check" }));

    expect(await screen.findByText("Ticketry is up to date"))
      .toBeInTheDocument();
    expect(runtime.appUpdates.check).toHaveBeenCalledTimes(2);
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
