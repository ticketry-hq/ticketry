import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";

/**
 * CODIN-915 regression: the default entry owns the one global ModalHost over
 * the shared modal stack.
 *
 * This mounts the real entry composition — `main.tsx`, with only the platform
 * boundaries replaced — and counts the hosts that actually render. Counting
 * rendered hosts rather than matching source text is what makes a second host
 * fail here, wherever it is added: a duplicate in the entry, or one nested
 * anywhere inside the app composition, since every `ModalHost` import resolves
 * to the counting substitute below.
 */

vi.mock("../app/modal/ModalHost", () => ({
  ModalHost: () => <div data-testid="counted-modal-host" />,
}));

// Platform boundaries only: no Tauri host, no file logging, no live runtime.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../shared/logging/webFileLogging", () => ({
  installWebFileLogging: vi.fn(async () => {}),
}));
vi.mock("../shared/logging/desktopFileLogging", () => ({
  installDesktopFileLogging: vi.fn(async () => {}),
}));

describe("single ModalHost over the shared modalStack (CODIN-915)", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("the default entry renders exactly one global ModalHost", async () => {
    await import("../main");

    // The real composition boots Apollo and the app shell, so the first paint
    // is slower than the default poll window under a loaded suite.
    await waitFor(
      () =>
        expect(
          document.querySelectorAll('[data-testid="counted-modal-host"]')
            .length,
        ).toBe(1),
      { timeout: 15_000 },
    );
  });
});
