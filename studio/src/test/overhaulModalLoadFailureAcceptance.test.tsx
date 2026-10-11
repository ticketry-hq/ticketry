import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModalHost } from "../app/modal/ModalHost";
import { useModalStore } from "../app/modal/modalStore";
import { createBrowserRuntime, initializeStudioRuntime } from "../runtime";

// Simulates the web-specific failure mode from ticket #1371: the hashed
// Settings chunk rejects (404 after a redeploy, offline, stale dev chunk).
// The property access happens inside ModalHost's lazy() loader, so throwing
// here rejects the dynamic import exactly as a missing chunk would.
const chunk = vi.hoisted(() => ({
  failNextLoad: false,
  // Browsers cache a rejected module fetch by URL: once the static specifier
  // failed, importing it again rejects without touching the network.
  staticImportCached: false,
  requestedUrls: [] as string[],
}));
const SETTINGS_CHUNK_URL =
  "http://127.0.0.1:5174/src/features/studio/modals/SettingsModal.tsx";

vi.mock("../features/studio/modals/SettingsModal", async () => {
  const { SettingsModalStub } = await import("./settingsModalStub");
  return {
    get SettingsModal() {
      if (chunk.failNextLoad || chunk.staticImportCached) {
        chunk.failNextLoad = false;
        throw new Error(
          `Failed to fetch dynamically imported module: ${SETTINGS_CHUNK_URL}`,
        );
      }
      return SettingsModalStub;
    },
  };
});

// The network boundary for a re-requested chunk URL.
vi.mock("../app/modal/importChunkUrl", () => ({
  importChunkUrl: async (url: string) => {
    chunk.requestedUrls.push(url);
    const { SettingsModalStub } = await import("./settingsModalStub");
    return { SettingsModal: SettingsModalStub };
  },
}));

describe("overhaul acceptance - modal chunk load failure", () => {
  beforeEach(() => {
    initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
    chunk.failNextLoad = false;
    chunk.staticImportCached = false;
    chunk.requestedUrls = [];
    useModalStore.setState({
      modalStack: [{ type: "settings" }],
      presentedNoticeIds: new Set(),
    });
  });

  afterEach(() => {
    useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
    vi.restoreAllMocks();
  });

  it("[overhaul-220] surfaces a recoverable panel instead of blanking the app when the settings chunk fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    chunk.failNextLoad = true;

    render(
      <>
        <main>Studio chrome stays mounted</main>
        <ModalHost />
      </>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(screen.getByText("Studio chrome stays mounted")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Settings could not be loaded/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Failed to fetch dynamically imported module/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("[overhaul-221] retries the failed chunk and shows the real settings dialog", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    chunk.failNextLoad = true;

    render(<ModalHost />);

    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("dialog", { name: "Studio settings" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("[overhaul-825] recovers when the browser keeps the failed chunk import cached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    chunk.staticImportCached = true;

    render(<ModalHost />);

    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("dialog", { name: "Studio settings" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(chunk.requestedUrls).toHaveLength(1);
    const retried = new URL(chunk.requestedUrls[0]);
    expect(`${retried.origin}${retried.pathname}`).toBe(SETTINGS_CHUNK_URL);
    expect(retried.search).not.toBe("");
  });

  it("[overhaul-222] closes the failed modal without blanking the app", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    chunk.failNextLoad = true;

    render(
      <>
        <main>Studio chrome stays mounted</main>
        <ModalHost />
      </>,
    );

    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(useModalStore.getState().modalStack).toHaveLength(0);
    expect(screen.getByText("Studio chrome stays mounted")).toBeInTheDocument();
  });

  it("[overhaul-223] shows a visible loading status while the modal chunk is pending", async () => {
    render(<ModalHost />);

    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent(/Loading/);

    expect(
      await screen.findByRole("dialog", { name: "Studio settings" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("[overhaul-224] renders nothing when the modal stack is empty", () => {
    useModalStore.setState({ modalStack: [] });
    const { container } = render(<ModalHost />);
    expect(container).toBeEmptyDOMElement();
  });
});
