import { act, fireEvent, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { useClientStore } from "../state/clientStore";
import { fixture, mountStudio, workItem } from "./seam";

it("keeps description input focused when its workspace body becomes active", async () => {
  const http = fixture();
  http.tree("module-1", { rootIds: ["story-a"], children: { "story-a": [] }, order: ["story-a"] });
  http.workItems([workItem({ id: "story-a", name: "Story A" })]);
  useClientStore.setState({
    sidebarVisible: false,
    editViewZone: "stories",
    editViewBodyEngaged: false,
    workspaces: {},
  });
  mountStudio({
    http,
    selectedTaskId: "story-a",
    children: (
      <SelectedTicketContent
        bucket="story-a"
        projectId="project-1"
        moduleId="module-1"
        owner="studio"
        details={<div contentEditable tabIndex={0} role="textbox" aria-label="Story description" />}
      />
    ),
  });

  const editor = await screen.findByRole("textbox", { name: "Story description" });
  act(() => editor.focus());
  expect(useClientStore.getState().editViewZone).toBe("active-tab-body");
  expect(editor).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "s" });
  expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
});
