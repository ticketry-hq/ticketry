/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LifecycleBadge } from "../../features/agents/terminal/LifecycleBadge";

describe("LifecycleBadge (#504)", () => {
  it("renders a labelled, accessible chip for an attention state", () => {
    render(<LifecycleBadge state="needs_input" />);
    const chip = screen.getByLabelText("Agent is waiting for your input");
    expect(chip).toHaveTextContent("Needs input");
    // Attention tone, not the focus-accent blue used by running counts.
    expect(chip.className).toContain("text-lifecycle-attention");
  });

  it("labels quiet honestly and stays in the idle tone", () => {
    render(<LifecycleBadge state="quiet" />);
    const chip = screen.getByLabelText(/heuristic/i);
    expect(chip).toHaveTextContent("Quiet");
    expect(chip.className).toContain("text-lifecycle-idle");
  });

  it("renders permission required as a visible status", () => {
    render(<LifecycleBadge state="permission_required" />);
    const chip = screen.getByLabelText(/permission decision is pending/i);
    expect(chip).toHaveTextContent("Permission required");
  });

  it("renders done in the success tone", () => {
    render(<LifecycleBadge state="turn_complete" />);
    const chip = screen.getByLabelText(/finished its turn/i);
    expect(chip).toHaveTextContent("Done");
    expect(chip.className).toContain("text-lifecycle-success");
  });

  it("renders nothing for the unknown state", () => {
    const { container } = render(<LifecycleBadge state="unknown" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("spins only the reconnecting glyph", () => {
    const { container } = render(<LifecycleBadge state="reconnecting" />);
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });
});
