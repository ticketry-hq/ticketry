import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockRejectedValue("native configuration unavailable"),
  isTauri: () => true,
}));

vi.mock("../app/studio/App", () => ({
  default: () => <div>Studio application</div>,
}));

describe("desktop Studio entry", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("renders an actionable failure when native initialization fails", async () => {
    await import("../main");

    expect(
      await screen.findByRole("heading", { name: "Studio could not start" }),
    ).toBeInTheDocument();
    expect(screen.getByText("native configuration unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("Check the runtime endpoint configuration and reload Studio."),
    ).toBeInTheDocument();
  });
});
