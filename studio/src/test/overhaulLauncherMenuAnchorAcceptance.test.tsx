import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  providerCapability,
  setProviderCapabilities,
  workspaceView,
} from "./taskAgentLaunchAcceptanceHarness";

function stubRect(element: HTMLElement, rect: { top: number; left: number; height: number; width: number }) {
  const box = {
    top: rect.top,
    left: rect.left,
    bottom: rect.top + rect.height,
    right: rect.left + rect.width,
    width: rect.width,
    height: rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  } as DOMRect;
  element.getBoundingClientRect = () => box;
}

describe("overhaul acceptance — launcher menu anchoring", () => {
  it("[overhaul-180] anchors the launcher menu outside the scrolling tab strip", () => {
    setProviderCapabilities([providerCapability("codex")]);
    render(
      workspaceView({
        launchContext: {
          kind: "scratch",
          onChooseMode: vi.fn(),
        },
      }),
    );

    const launcher = screen.getByRole("button", { name: "＋ Agent" });
    stubRect(launcher, { top: 40, left: 128, height: 22, width: 62 });
    fireEvent.click(launcher);

    // The tab strip clips its overflow, so an in-flow dropdown would be cut off
    // at the strip's edge whatever its z-index. The menu must be fixed to the
    // viewport and anchored to the trigger instead.
    const menu = screen.getByRole("menu", { name: "Launch agent" });
    expect(menu.className).toContain("fixed");
    expect(menu.className).not.toContain("absolute");
    expect(menu.style.top).toBe("66px");
    expect(menu.style.left).toBe("128px");
    expect(screen.getByTestId("workspace-tabs")).toContainElement(menu);

    // Scrolling the strip moves the trigger, and the open menu follows it.
    stubRect(launcher, { top: 40, left: 64, height: 22, width: 62 });
    fireEvent.scroll(screen.getByTestId("workspace-tabs"));
    expect(menu.style.left).toBe("64px");
  });
});
