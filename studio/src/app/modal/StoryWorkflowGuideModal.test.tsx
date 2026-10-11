import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoryWorkflowGuideModal } from "./StoryWorkflowGuideModal";
import { useModalStore } from "./modalStore";

// The guide's own content reads Story data; closing focus is owned here.
vi.mock("../../features/workflows", () => ({
  StoryWorkflowGuideDialog: ({ onClose }: { onClose: () => void }) => (
    <button type="button" onClick={onClose}>Close</button>
  ),
}));

function renderFromTrigger(invoker: HTMLElement) {
  invoker.focus();
  useModalStore.getState().pushModal({ type: "story-workflow-guide", payload: { storyId: "story-a" } });
  return render(<StoryWorkflowGuideModal storyId="story-a" source="toolbar" />);
}

async function flushFrame() {
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

describe("StoryWorkflowGuideModal closing focus", () => {
  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    useModalStore.setState({ modalStack: [] });
  });

  function mountTriggers() {
    const retained = Object.assign(document.createElement("button"), { textContent: "Retained guide" });
    retained.setAttribute("data-story-workflow-guide-toolbar", "");
    const visible = Object.assign(document.createElement("button"), { textContent: "Visible guide" });
    visible.setAttribute("data-story-workflow-guide-toolbar", "");
    document.body.append(retained, visible);
    return { retained, visible };
  }

  it("returns Close focus to the invoking toolbar control rather than a retained earlier one", async () => {
    const { retained, visible } = mountTriggers();
    renderFromTrigger(visible);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await flushFrame();
    expect(visible).toHaveFocus();
    expect(retained).not.toHaveFocus();
  });

  it("returns Escape focus to the invoking toolbar control rather than a retained earlier one", async () => {
    const { retained, visible } = mountTriggers();
    renderFromTrigger(visible);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await flushFrame();
    expect(visible).toHaveFocus();
    expect(retained).not.toHaveFocus();
  });
});
