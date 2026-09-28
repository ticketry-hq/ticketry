/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LifecycleBadge } from "../../features/agents/terminal/LifecycleBadge";

describe("LifecycleBadge running chip provider colour (#2251)", () => {
  it("wears orange for a running Claude run", () => {
    render(<LifecycleBadge state="working" agent="claude" />);
    const chip = screen.getByLabelText("Agent is actively working");
    expect(chip.className).toContain("text-provider-claude");
  });

  it("wears white for a running Codex run", () => {
    render(<LifecycleBadge state="working" agent="codex" />);
    const chip = screen.getByLabelText("Agent is actively working");
    expect(chip.className).toContain("text-provider-codex");
  });

  it("keeps attention states on the lifecycle palette", () => {
    render(<LifecycleBadge state="needs_input" agent="claude" />);
    const chip = screen.getByLabelText("Agent is waiting for your input");
    expect(chip.className).toContain("text-lifecycle-attention");
  });
});
