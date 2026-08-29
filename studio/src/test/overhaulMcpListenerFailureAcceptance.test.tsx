import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ModalHost } from "../app/modal/ModalHost";
import { useModalStore } from "../app/modal/modalStore";
import {
  createBrowserRuntime,
  initializeStudioRuntime,
  type StudioRuntime,
} from "../runtime";

describe("overhaul acceptance - fail-closed MCP listener failure", () => {
  afterEach(() => {
    useModalStore.setState({ modalStack: [] });
  });

  it("[overhaul-172] keeps shells available while agent launch waits for this instance's listener", async () => {
    const base = createBrowserRuntime({ environment: {} });
    const startup = base.startup();
    initializeStudioRuntime({
      ...base,
      startup: () => ({
        ...startup,
        serviceHealth: {
          state: "ready",
          service: null,
          message: null,
          logPointer: null,
        },
        initialNotices: [
          {
            id: "mcp-unavailable",
            severity: "warning",
            title: "Agent launches unavailable",
            message:
              "Ticketry could not start its MCP listener. Agent launches are blocked until this Ticketry instance owns an MCP listener. Local shells remain available. Restart Ticketry to retry.",
            acknowledgementLabel: "Understood",
          },
        ],
      }),
      subscribeUserNotices: () => () => {},
    } satisfies StudioRuntime);

    render(
      <>
        <main>Local Studio remains usable</main>
        <ModalHost />
      </>,
    );

    expect(screen.getByText("Local Studio remains usable")).toBeInTheDocument();
    expect(
      await screen.findByRole("dialog", { name: "Agent launches unavailable" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Agent launches are blocked/)).toBeInTheDocument();
    expect(screen.getByText(/Local shells remain available/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue without MCP" }))
      .not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Understood" }));
    expect(
      screen.queryByRole("dialog", { name: "Agent launches unavailable" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Local Studio remains usable")).toBeInTheDocument();
  });
});
