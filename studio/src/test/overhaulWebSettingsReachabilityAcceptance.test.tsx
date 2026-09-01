/**
 * Settings stays reachable while a startup gate owns the screen (#1371).
 *
 * The footer Settings button and the global `e` chord both live inside
 * `StudioShell`, which the service-health and bootstrap gates fully replace.
 * In the web version those gate screens are routine — the Vite dev server is
 * reachable before the Rust GraphQL adapter is — so a user stuck on one of them
 * had no way at all to open Settings. Each gate screen therefore carries its
 * own "Open Settings" affordance, and `ModalHost` (mounted outside the gates)
 * presents the modal over it.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import StudioApp from "../app/StudioApp";
import { ModalHost } from "../app/modal/ModalHost";
import { useModalStore } from "../app/modal/modalStore";
import {
  createBrowserRuntime,
  initializeStudioRuntime,
  type ServiceHealth,
  type StudioRuntime,
} from "../runtime";

const bootstrap = vi.hoisted(() => ({ bootstrapStudio: vi.fn() }));

vi.mock("../app/startup/bootstrapStudio", () => bootstrap);

function installBrowserRuntime(serviceHealth?: ServiceHealth): void {
  const base = createBrowserRuntime({ environment: {} });
  const startup = base.startup();
  initializeStudioRuntime({
    ...base,
    startup: () => ({
      ...startup,
      ...(serviceHealth ? { serviceHealth } : {}),
    }),
    // The stock browser runtime republishes its own "ready" health on
    // subscribe, which would immediately clear the health under test.
    ...(serviceHealth
      ? {
          subscribeServiceHealth: (listener) => {
            listener(serviceHealth);
            return () => {};
          },
        }
      : {}),
  } satisfies StudioRuntime);
}

async function openSettingsFromGate(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
  expect(
    await screen.findByRole("dialog", { name: "Studio settings" }),
  ).toBeVisible();
}

describe("overhaul acceptance — web settings reachability from startup gates", () => {
  beforeEach(() => {
    bootstrap.bootstrapStudio.mockResolvedValue("unavailable");
    useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
  });

  afterEach(() => {
    vi.resetAllMocks();
    useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
    initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
  });

  it("[overhaul-217] opens Settings from the bootstrap connecting screen", async () => {
    installBrowserRuntime();

    render(
      <>
        <StudioApp />
        <ModalHost />
      </>,
    );

    expect(
      await screen.findByText("Connecting to local work tracker…"),
    ).toBeInTheDocument();
    await openSettingsFromGate();
  });

  it("[overhaul-218] opens Settings from the failed service-health screen", async () => {
    installBrowserRuntime({
      state: "failed",
      service: "rust-graphql-adapter",
      message: "The local server stopped unexpectedly.",
      logPointer: null,
    });

    render(
      <>
        <StudioApp />
        <ModalHost />
      </>,
    );

    expect(
      screen.getByRole("heading", { name: "Ticketry services could not start" }),
    ).toBeInTheDocument();
    await openSettingsFromGate();
  });

  it("[overhaul-219] opens Settings while service health is not yet ready", async () => {
    installBrowserRuntime({
      state: "starting",
      service: "rust-graphql-adapter",
      message: null,
      logPointer: null,
    });

    render(
      <>
        <StudioApp />
        <ModalHost />
      </>,
    );

    expect(
      screen.getByRole("heading", { name: "Preparing Ticketry data" }),
    ).toBeInTheDocument();
    await openSettingsFromGate();
  });
});
