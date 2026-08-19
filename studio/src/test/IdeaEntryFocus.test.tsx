import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IdeaEntry } from "../app/shell/ticket-workspace/tasks/components/IdeaEntry";

describe("IdeaEntry focus feedback", () => {
  it("marks the entry focused while the textarea holds focus", () => {
    render(<IdeaEntry />);

    const input = screen.getByLabelText("Capture an idea");
    const field = input.closest("[data-idea-entry-field]");
    expect(field).not.toBeNull();
    expect(field).toHaveAttribute("data-focused", "false");

    fireEvent.focus(input);
    expect(field).toHaveAttribute("data-focused", "true");

    fireEvent.blur(input);
    expect(field).toHaveAttribute("data-focused", "false");
  });
});
