import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../app/studio/App", () => ({
  default: function TaskWorkspace() {
    return <div data-testid="studio-task-workspace">Task workspace</div>;
  },
}));

vi.mock("../app/modal", () => ({
  ModalHost: () => null,
}));

vi.mock("../app/shell/ToastHost", () => ({
  default: () => <div data-testid="standalone-toast-host" />,
}));

describe("default Studio entry", () => {
  it("mounts the task workspace without a router", async () => {
    document.body.innerHTML = '<div id="root"></div>';

    await import("../main");

    expect(await screen.findByTestId("studio-task-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("standalone-toast-host")).toBeInTheDocument();
  });
});
