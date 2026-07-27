import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { ModalShell } from "../app/modal/ModalShell";
import { useModalStore } from "../app/modal/modalStore";
import { MODAL_ACTIONS } from "../app/navigation/keymapRegistry";

function ModalHarness() {
  const [cursor, setCursor] = useState(0);
  return (
    <ModalShell
      title="Registry modal"
      bindings={[
        {
          actionId: [MODAL_ACTIONS.previous, MODAL_ACTIONS.next],
          label: "Move",
        },
        { actionId: MODAL_ACTIONS.confirm, label: "Choose" },
        { actionId: MODAL_ACTIONS.close, label: "Cancel" },
      ]}
      onAction={(actionId) => {
        if (actionId === MODAL_ACTIONS.next) setCursor((value) => value + 1);
        if (actionId === MODAL_ACTIONS.previous) {
          setCursor((value) => value - 1);
        }
      }}
    >
      <input aria-label="Modal input" />
      <output aria-label="Cursor">{cursor}</output>
    </ModalShell>
  );
}

describe("modal keymap context", () => {
  beforeEach(() => {
    useModalStore.setState({
      modalStack: [{ type: "agent-picker" }, { type: "settings" }],
      activeBindings: null,
    });
  });

  it("routes modal actions through the registry and resolves effective hints", () => {
    render(<ModalHarness />);
    const input = screen.getByRole("textbox", { name: "Modal input" });

    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(screen.getByRole("status", { name: "Cursor" })).toHaveTextContent("1");
    expect(useModalStore.getState().activeBindings).toEqual([
      { key: "↑↓", label: "Move" },
      { key: "Enter", label: "Choose" },
      { key: "Esc", label: "Cancel" },
    ]);
  });

  it("reserves Escape for closing only the top modal", () => {
    render(<ModalHarness />);

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Modal input" }), {
      key: "Escape",
    });

    expect(useModalStore.getState().modalStack).toEqual([
      { type: "agent-picker" },
    ]);
  });
});
