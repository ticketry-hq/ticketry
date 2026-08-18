import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CoachMark, {
  coachMarkPlacement,
} from "../app/onboarding/CoachMark";

const domRect = ({
  left,
  top,
  width,
  height,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
}) =>
  ({
    x: left,
    y: top,
    top,
    left,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  }) as DOMRect;

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
    expect(screen.getByTestId("anchor")).toHaveAttribute(
      "data-coach-highlight",
      "true",
    );

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByTestId("anchor")).toHaveFocus();
  });

  it("recalculates anchored placement on resize and falls back in flow without an anchor", () => {
    let anchorRect = domRect({ left: 10, top: 20, width: 100, height: 40 });
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        return this.getAttribute("data-coach-anchor")
          ? anchorRect
          : domRect({ left: 0, top: 0, width: 352, height: 120 });
      });

    const { rerender } = render(
      <>
        <button data-testid="anchor" data-coach-anchor="anchor">Anchor</button>
        <CoachMark anchor="anchor" title="Tour" description="Step" />
      </>,
    );
    const anchor = screen.getByTestId("anchor");
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveStyle({ position: "fixed", top: "68px", left: "16px" });

    anchorRect = domRect({ left: 30, top: 40, width: 100, height: 40 });
    fireEvent(window, new Event("resize"));
    expect(dialog).toHaveStyle({ top: "88px", left: "16px" });

    rerender(<CoachMark anchor="missing" title="Tour" description="Step" />);
    expect(screen.getByRole("dialog")).toHaveAttribute("data-placement", "in-flow");
    expect(anchor).not.toHaveAttribute("data-coach-highlight");
    rect.mockRestore();
  });

  it("keeps a modal control's coach mark beside its field inside the modal", () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.getAttribute("aria-modal") === "true") {
          return domRect({ left: 250, top: 100, width: 400, height: 600 });
        }
        if (this.getAttribute("data-coach-anchor")) {
          return domRect({ left: 300, top: 160, width: 300, height: 40 });
        }
        return domRect({ left: 0, top: 0, width: 320, height: 140 });
      });

    render(
      <>
        <div role="dialog" aria-modal="true" aria-label="Add Module">
          <input data-coach-anchor="module-name" aria-label="Module name" />
        </div>
        <CoachMark anchor="module-name" title="Name it" description="Choose a name." />
      </>,
    );

    const coachMark = screen.getByRole("dialog", { name: "Name it" });
    expect(coachMark).toHaveAttribute("data-placement-side", "below");
    expect(coachMark).toHaveStyle({ top: "208px", left: "290px" });
    rect.mockRestore();
  });

  it("keeps a callout on screen when its highlighted surface reaches the viewport bottom", () => {
    expect(
      coachMarkPlacement({
        anchor: domRect({ left: 450, top: 84, width: 1510, height: 1200 }),
        callout: { width: 352, height: 160 },
        viewport: { width: 2000, height: 1300 },
      }),
    ).toEqual({ side: "left", top: 604, left: 90 });
  });
});
