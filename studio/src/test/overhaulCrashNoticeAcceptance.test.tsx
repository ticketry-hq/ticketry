import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CrashNotice } from "../features/crash-diagnostics";

const crashReports = vi.hoisted(() => ({
  latestCollectionOutcome: vi.fn(),
  revealFolder: vi.fn(),
}));

vi.mock("../runtime", async () => ({
  ...(await vi.importActual<typeof import("../runtime")>("../runtime")),
  studioRuntime: () => ({
    crashReports,
    startup: () => ({ runtimeInstance: "crash-notice-test-run" }),
  }),
}));

describe("overhaul acceptance - Crash Notice", () => {
  beforeEach(() => {
    sessionStorage.clear();
    crashReports.latestCollectionOutcome.mockReset();
    crashReports.revealFolder.mockReset();
    crashReports.revealFolder.mockResolvedValue(undefined);
  });

  it("stays absent after a clean exit", async () => {
    crashReports.latestCollectionOutcome.mockResolvedValue({ status: "none" });

    render(<CrashNotice />);

    await waitFor(() => {
      expect(crashReports.latestCollectionOutcome).toHaveBeenCalledOnce();
    });
    expect(
      screen.queryByText("Ticketry closed unexpectedly last time"),
    ).not.toBeInTheDocument();
  });

  it("[overhaul-207] shows a non-modal notice after a Crash", async () => {
    crashReports.latestCollectionOutcome.mockResolvedValue({
      status: "report_collected",
    });

    render(
      <>
        <button type="button">Keep working</button>
        <CrashNotice />
      </>,
    );

    expect(
      await screen.findByRole("status", {
        name: "Ticketry closed unexpectedly last time",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep working" })).toBeEnabled();
  });

  it("reveals the Crash Report folder", async () => {
    crashReports.latestCollectionOutcome.mockResolvedValue({
      status: "report_collected",
    });
    render(<CrashNotice />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Reveal Crash Reports" }),
    );

    expect(crashReports.revealFolder).toHaveBeenCalledOnce();
  });

  it("dismisses the Crash Notice for the current session", async () => {
    crashReports.latestCollectionOutcome.mockResolvedValue({
      status: "report_collected",
    });
    const firstMount = render(<CrashNotice />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Dismiss Crash Notice" }),
    );

    expect(
      screen.queryByText("Ticketry closed unexpectedly last time"),
    ).not.toBeInTheDocument();

    firstMount.unmount();
    render(<CrashNotice />);
    expect(
      screen.queryByText("Ticketry closed unexpectedly last time"),
    ).not.toBeInTheDocument();
    expect(crashReports.latestCollectionOutcome).toHaveBeenCalledOnce();
  });

});
