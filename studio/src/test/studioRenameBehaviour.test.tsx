import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixture, mountStudio, workItem } from "./seam";

describe("Studio work-item behaviour", () => {
  it("shows a details rename in the Stories pane", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: ["story-1"],
      children: { "story-1": [] },
      order: ["story-1"],
    });
    http.workItems([
      workItem({ id: "story-1", name: "Old name", parent_id: "module-1" }),
    ]);
    const patched = http.expectPatch("story-1", { name: "New name" });
    mountStudio({ http });

    const stories = await screen.findByRole("region", { name: "Stories" });
    fireEvent.click(await within(stories).findByRole("treeitem", { name: /Old name/ }));
    const details = screen.getByRole("region", { name: "Details" });
    fireEvent.click(await within(details).findByText("Old name"));
    const name = await screen.findByRole("textbox", { name: "Name" });
    fireEvent.change(name, { target: { value: "New name" } });
    fireEvent.keyDown(name, { key: "Enter" });

    await patched;
    expect(await within(stories).findByText("New name")).toBeVisible();
    await waitFor(() => expect(within(stories).queryByText("Old name")).toBeNull());
  });
});
