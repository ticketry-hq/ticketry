import { afterEach, describe, expect, it } from "vitest";

import { suppressNativeContextMenu } from "./suppressNativeContextMenu";

function contextMenuOn(target: EventTarget): boolean {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return !event.defaultPrevented;
}

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
  document.body.innerHTML = "";
});

describe("native context menu suppression", () => {
  it("blocks the page-background menu that carries Reload", () => {
    restore = suppressNativeContextMenu(window);

    expect(contextMenuOn(document.body)).toBe(false);
  });

  it("keeps the menu on editable fields, where it means Cut/Copy/Paste", () => {
    restore = suppressNativeContextMenu(window);
    const input = document.createElement("input");
    const area = document.createElement("textarea");
    document.body.append(input, area);

    expect(contextMenuOn(input)).toBe(true);
    expect(contextMenuOn(area)).toBe(true);
  });

  it("blocks the menu on read-only fields", () => {
    restore = suppressNativeContextMenu(window);
    const input = document.createElement("input");
    input.readOnly = true;
    document.body.appendChild(input);

    expect(contextMenuOn(input)).toBe(false);
  });

  it("stops blocking once uninstalled", () => {
    const uninstall = suppressNativeContextMenu(window);
    uninstall();

    expect(contextMenuOn(document.body)).toBe(true);
  });
});
