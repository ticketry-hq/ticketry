import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ToastHost from "../app/shell/ToastHost";
import { useToastStore } from "../app/shell/toastStore";

// CODING-1546: toasts were 10–15% alpha tints straight over whatever sat
// beneath them, so text was hard to read over busy content. Every kind must
// paint an opaque panel first and carry its lifecycle tint on top.
describe("toast opacity (CODING-1546)", () => {
  afterEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it.each(["success", "info", "error"] as const)("[overhaul-283] %s toast has an opaque base", (kind) => {
    useToastStore.setState({
      toasts: [{ id: 1, kind, message: `${kind} message` }],
    });
    render(<ToastHost />);
    const toast = screen.getByTestId(`toast-${kind}`);
    expect(toast.className).toContain("bg-pane-panel");
    expect(toast.className).toMatch(/from-lifecycle-\w+\/\d+/);
  });
});
