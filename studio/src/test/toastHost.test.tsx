import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useModalStore } from "../app/modal";
import ToastHost from "../app/shell/ToastHost";
import { toast, useClientStore } from "../state/clientStore";

describe("ToastHost", () => {
  beforeEach(() => {
    useModalStore.setState({ modalStack: [], activeBindings: null });
    useClientStore.setState({ toasts: [] });
  });

  it("suppresses toasts while Settings is open and renders them after it closes", () => {
    toast.success("Saved elsewhere");
    const view = render(<ToastHost />);

    expect(screen.getByText("Saved elsewhere")).toBeVisible();

    useModalStore.setState({ modalStack: [{ type: "settings" }] });
    view.rerender(<ToastHost />);
    expect(screen.queryByText("Saved elsewhere")).not.toBeInTheDocument();

    useModalStore.setState({ modalStack: [] });
    view.rerender(<ToastHost />);
    expect(screen.getByText("Saved elsewhere")).toBeVisible();
  });
});
