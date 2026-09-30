import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import StudioApp from "../app/StudioApp";

const crashReports = vi.hoisted(() => ({
  latestCollectionOutcome: vi.fn(),
}));

vi.mock("../runtime", async () => ({
  ...(await vi.importActual<typeof import("../runtime")>("../runtime")),
  studioRuntime: () => ({
    crashReports,
    startup: () => ({ runtimeInstance: "crash-notice-test-run" }),
  }),
}));

vi.mock("../app/startup/BootstrapGate", () => ({
  BootstrapGate: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("../app/startup/ServiceHealthGate", () => ({
  ServiceHealthGate: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("../app/onboarding/OnboardingGate", () => ({
  OnboardingGate: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("../app/shell/StudioShell", () => ({
  StudioShell: () => <button type="button">Keep working</button>,
}));

describe("overhaul acceptance - Crash Notice", () => {
  it("[overhaul-207] keeps Studio free of a Crash Notice after a Crash Report is collected", () => {
    crashReports.latestCollectionOutcome.mockResolvedValue({
      status: "report_collected",
    });

    render(<StudioApp />);

    expect(
      screen.queryByText("Ticketry closed unexpectedly last time"),
    ).not.toBeInTheDocument();
    expect(crashReports.latestCollectionOutcome).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Keep working" })).toBeEnabled();
  });
});
