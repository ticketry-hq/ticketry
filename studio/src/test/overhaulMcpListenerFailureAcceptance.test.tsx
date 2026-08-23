import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ModalHost } from "../app/modal/ModalHost";
import { useModalStore } from "../app/modal/modalStore";
import {
  createBrowserRuntime,
  initializeStudioRuntime,
  type StudioRuntime,
} from "../runtime";

describe("overhaul acceptance - optional MCP listener failure", () => {
  afterEach(() => {
    useModalStore.setState({ modalStack: [] });
  });

  it("keeps local Studio visible while explaining that provider launch is unavailable", async () => {
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
            title: "External MCP unavailable",
            message:
              "Ticketry is running, but external MCP connections are unavailable. Provider launch remains blocked until it recovers.",
            acknowledgementLabel: "Continue without MCP",
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
      await screen.findByRole("dialog", { name: "External MCP unavailable" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue without MCP" }));
    expect(
      screen.queryByRole("dialog", { name: "External MCP unavailable" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Local Studio remains usable")).toBeInTheDocument();
  });
});
