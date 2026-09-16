import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { fixture, mountStudio, workItem } from "./seam";

const editor = vi.hoisted(() => ({ loaded: vi.fn(), mounted: vi.fn() }));
vi.mock("../features/documents/RichMarkdownEditor", () => {
  editor.loaded();
  return {
    default: ({ markdown }: { markdown: string }) => {
      editor.mounted();
      return <textarea aria-label="Preloaded description editor" defaultValue={markdown} />;
    },
  };
});

afterEach(() => vi.restoreAllMocks());

it("[overhaul-287] shows Details before warming shared editor code and mounts it only on description click", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  const http = fixture();
  http.tree("module-1", { rootIds: ["story-preload"], children: { "story-preload": [] }, order: ["story-preload"] });
  http.workItems([workItem({ id: "story-preload", name: "Preload story", description: "Read this immediately" })]);
  mountStudio({ http, selectedTaskId: "story-preload" });
  const details = await screen.findByRole("region", { name: "Details" });
  // Settle the lazy read-view chunk; rich editor warming still waits for paint.
  await act(() => vi.dynamicImportSettled());
  expect(within(details).getByText("Read this immediately")).toBeVisible();
  expect(editor.loaded).not.toHaveBeenCalled();
  expect(editor.mounted).not.toHaveBeenCalled();

  act(() => frames.splice(0).forEach((callback) => callback(performance.now())));
  await waitFor(() => expect(editor.loaded).toHaveBeenCalledTimes(1));
  expect(editor.mounted).not.toHaveBeenCalled();
  fireEvent.click(within(details).getByTestId("issue-description"));
  expect(await within(details).findByLabelText("Preloaded description editor")).toHaveValue("Read this immediately");
  expect(editor.loaded).toHaveBeenCalledTimes(1);
});
