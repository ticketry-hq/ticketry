import { afterEach, describe, expect, it, vi } from "vitest";
import { observeEnabledRichTextEditable } from "./richMarkdownEditorReadiness";

describe("observeEnabledRichTextEditable", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("finds an enabled contenteditable added after the editor shell mounts", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const ready = vi.fn();
    observeEnabledRichTextEditable(root, ready);

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    root.append(editable);
    await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(1));

    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("stops watching after cleanup", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const ready = vi.fn();
    const stop = observeEnabledRichTextEditable(root, ready);
    stop();

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    root.append(editable);
    await Promise.resolve();

    expect(ready).not.toHaveBeenCalled();
  });
});
