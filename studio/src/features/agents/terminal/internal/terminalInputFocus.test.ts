import { afterEach, describe, expect, it } from "vitest";

import {
  hasFocusedTerminalInput,
  isTerminalInputElement,
} from "./terminalInputFocus";

afterEach(() => {
  document.body.innerHTML = "";
});

function mount(html: string): HTMLDivElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);
  return container;
}

describe("isTerminalInputElement", () => {
  it("recognises the ghostty-wasm hidden textarea", () => {
    const container = mount(
      '<textarea data-testid="ghostty-wasm-input"></textarea>',
    );
    expect(isTerminalInputElement(container.firstElementChild)).toBe(true);
  });

  it("recognises xterm's helper textarea", () => {
    const container = mount('<div class="xterm"><textarea></textarea></div>');
    expect(isTerminalInputElement(container.querySelector("textarea"))).toBe(
      true,
    );
  });

  it("rejects unrelated elements and non-elements", () => {
    const container = mount("<button></button>");
    expect(isTerminalInputElement(container.firstElementChild)).toBe(false);
    expect(isTerminalInputElement(null)).toBe(false);
    expect(isTerminalInputElement("ghostty-wasm-input")).toBe(false);
  });
});

describe("hasFocusedTerminalInput", () => {
  it("is true when a contained terminal input holds focus", () => {
    const container = mount(
      '<textarea data-testid="ghostty-wasm-input"></textarea>',
    );
    (container.firstElementChild as HTMLTextAreaElement).focus();
    expect(hasFocusedTerminalInput(container)).toBe(true);
  });

  it("is false when the focused input lives outside the container", () => {
    const container = mount("<div></div>");
    const outside = mount(
      '<textarea data-testid="ghostty-wasm-input"></textarea>',
    );
    (outside.firstElementChild as HTMLTextAreaElement).focus();
    expect(hasFocusedTerminalInput(container)).toBe(false);
  });

  it("is false when focus rests on a non-terminal element or nothing", () => {
    const container = mount("<input />");
    (container.firstElementChild as HTMLInputElement).focus();
    expect(hasFocusedTerminalInput(container)).toBe(false);
    expect(hasFocusedTerminalInput(null)).toBe(false);
  });
});
