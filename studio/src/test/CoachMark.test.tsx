import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CoachMark from "../app/onboarding/CoachMark";

describe("CoachMark", () => {
  it("is an accessible non-modal dialog and Escape restores the anchor focus", () => {
    render(
      <>
        <button data-testid="anchor" data-coach-anchor="anchor">Anchor</button>
        <CoachMark
          anchor="anchor"
          title="Project switcher"
          description="Switch projects here."
        >
          <button>Continue</button>
        </CoachMark>
      </>,
    );

    const dialog = screen.getByRole("dialog", { name: "Project switcher" });
    expect(dialog).toHaveAttribute("aria-modal", "false");
    expect(dialog).toHaveAccessibleDescription("Switch projects here.");
    expect(dialog).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByTestId("anchor")).toHaveFocus();
  });

  it("recalculates anchored placement on resize and falls back in flow without an anchor", () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValueOnce({
        x: 10, y: 20, top: 20, left: 10, right: 110, bottom: 60,
        width: 100, height: 40, toJSON: () => ({}),
      } as DOMRect)
      .mockReturnValueOnce({
        x: 30, y: 40, top: 40, left: 30, right: 130, bottom: 80,
        width: 100, height: 40, toJSON: () => ({}),
      } as DOMRect);

    const { rerender } = render(
      <>
        <button data-testid="anchor" data-coach-anchor="anchor">Anchor</button>
        <CoachMark anchor="anchor" title="Tour" description="Step" />
      </>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveStyle({ position: "fixed", top: "68px", left: "10px" });

    fireEvent(window, new Event("resize"));
    expect(dialog).toHaveStyle({ top: "88px", left: "30px" });

    rerender(<CoachMark anchor="missing" title="Tour" description="Step" />);
    expect(screen.getByRole("dialog")).toHaveAttribute("data-placement", "in-flow");
    rect.mockRestore();
  });
});
