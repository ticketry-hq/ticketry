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

  it("[overhaul-05] repaints an externally edited row and open details from one notification", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: ["story-1"],
      children: { "story-1": [] },
      order: ["story-1"],
    });
    http.workItems([
      workItem({
        id: "story-1",
        name: "Before MCP",
        description: "Old description",
        parent_id: "module-1",
      }),
    ]);
    mountStudio({ http });

    const stories = await screen.findByRole("region", { name: "Stories" });
    fireEvent.click(
      await within(stories).findByRole("treeitem", { name: /Before MCP/ }),
    );
    const details = screen.getByRole("region", { name: "Details" });
    expect(await within(details).findByText("Old description")).toBeVisible();

    http.workItems([
      workItem({
        id: "story-1",
        name: "After MCP",
        description: "Fresh description",
        parent_id: "module-1",
        state_revision: 2,
      }),
    ]);
    http.notifications.workItemChanged("story-1", 2);

    expect(await within(stories).findByText("After MCP")).toBeVisible();
    expect(await within(details).findByText("Fresh description")).toBeVisible();
    expect(within(stories).queryByText("Before MCP")).toBeNull();
  });

  it("[overhaul-14] replays missed creates once and refreshes module membership", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: ["story-1"],
      children: { "story-1": [] },
      order: ["story-1"],
    });
    http.workItems([workItem({ id: "story-1", name: "Existing" })]);
    mountStudio({ http });
    const stories = await screen.findByRole("region", { name: "Stories" });
    expect(await within(stories).findByText("Existing")).toBeVisible();

    http.notifications.disconnect();
    http.workItems([
      workItem({
        id: "story-2",
        name: "Created while offline",
        sequence_id: 2,
        key: "MEML-2",
        state_revision: 2,
      }),
    ]);
    http.tree("module-1", {
      rootIds: ["story-1", "story-2"],
      children: { "story-1": [], "story-2": [] },
      order: ["story-1", "story-2"],
    });
    http.notifications.workItemChanged("story-2", 2, true);
    http.notifications.workItemChanged("story-2", 2, true);
    expect(within(stories).queryByText("Created while offline")).toBeNull();

    http.notifications.reconnect();
    expect(await within(stories).findByText("Created while offline")).toBeVisible();
    expect(within(stories).getAllByText("Created while offline")).toHaveLength(1);
  });
});
