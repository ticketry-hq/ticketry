import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { WorkTrackerWorkItemDocument } from "../features/work-items/generated/workItems.documents";
import { WorkTrackerProjectOpenDocument } from "../features/projects";
import { studioApolloClient } from "../shared/apollo/client";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { DialogHost } from "../app/shell/DialogHost";
import { moduleManagerArchiveBoundary } from "./moduleManagerArchiveBoundary";

it("[overhaul-647] confirms the named archive cascade, cancels without a write, and retains context for server refusal and retry", async () => {
  const boundary = moduleManagerArchiveBoundary();
  boundary.mount({ shell: true, selectedTaskId: null, graphQlExecute: boundary.execute, children: <DialogHost /> });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  const row = within(manager).getByRole("button", { name: "Archive Roadmap" });
  await waitFor(() => expect(row).toBeEnabled());
  fireEvent.click(row);
  const confirmation = await screen.findByRole("dialog", { name: "Archive Roadmap?" });
  expect(confirmation).toHaveTextContent("all descendant Stories and work items");
  fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(row).toBeEnabled());
  expect(boundary.calls.filter((call) => call.operation === "ArchiveWorkTrackerWorkItem")).toEqual([]);
  boundary.refuse(true);
  fireEvent.click(row);
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Archive module" }));
  expect(await within(manager).findByText(/Server refused this archive/)).toBeVisible();
  expect(screen.getByRole("tab", { name: "Roadmap", hidden: true })).toHaveAttribute("aria-selected", "true");
  boundary.refuse(false);
  fireEvent.click(row);
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Archive module" }));
  await waitFor(() => expect(screen.queryByRole("tab", { name: "Roadmap", hidden: true })).toBeNull());
  fireEvent.click(within(manager).getByRole("button", { name: "Archived 1 modules" }));
  expect(within(within(manager).getByRole("region", { name: "Archived" })).getByRole("button", { name: "Inspect Roadmap" })).toBeVisible();
  expect(boundary.calls.filter((call) => call.operation === "ArchiveWorkTrackerWorkItem").map((call) => call.variables)).toEqual([
    { id: "module-1", isArchived: true }, { id: "module-1", isArchived: true },
  ]);
  expect(boundary.calls.filter((call) => call.operation === "UpdateWorkTrackerModulePresentation")).toEqual([]);
});

it("[overhaul-648] prevents duplicate row/detail archive writes and repairs selected-module fallback even if the committed archive refresh fails", async () => {
  const boundary = moduleManagerArchiveBoundary();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let writes = 0;
  let failArchiveRefresh = true;
  boundary.mount({ shell: true, selectedTaskId: null, children: <DialogHost />,
    graphQlExecute: async (document, variables) => {
      const operation = documentOperationName(document);
      if (operation === "ArchiveWorkTrackerWorkItem") { writes++; await pending; }
      if (operation === "ModuleManagerArchivedModules" && boundary.modules[0]!.is_archived && failArchiveRefresh) throw new Error("Archive membership refresh failed");
      return boundary.execute(document, variables);
    } });
  fireEvent.click(await screen.findByRole("button", { name: "Show all sprints" }));
  await screen.findByRole("tab", { name: "0.2.0" });
  fireEvent.click(screen.getByRole("button", { name: "Open Module Manager" }));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  fireEvent.click(within(manager).getByRole("button", { name: "Inspect Roadmap" }));
  const detail = screen.getByRole("region", { name: "Module details: Roadmap" });
  fireEvent.click(within(detail).getByRole("button", { name: "Archive Roadmap" }));
  const confirmation = await screen.findByRole("dialog", { name: "Archive Roadmap?" });
  fireEvent.click(within(confirmation).getByRole("button", { name: "Archive module" }));
  await waitFor(() => expect(writes).toBe(1));
  const duplicates = within(manager).getAllByRole("button", { name: "Archive Roadmap" });
  duplicates.forEach((button) => { expect(button).toBeDisabled(); fireEvent.click(button); });
  expect(writes).toBe(1);
  await act(async () => { release(); await pending; });
  await waitFor(() => expect(screen.getByRole("tab", { name: "0.2.0" })).toHaveAttribute("aria-selected", "true"));
  expect(screen.queryByRole("tab", { name: "Roadmap" })).toBeNull();
  fireEvent.click(within(manager).getByRole("button", { name: "Archived 1 modules" }));
  expect(within(within(manager).getByRole("region", { name: "Archived" })).getByRole("button", { name: "Inspect Roadmap" })).toBeVisible();
  expect(await within(manager).findByText("Archive membership refresh failed")).toBeVisible();
  failArchiveRefresh = false;
  fireEvent.click(within(manager).getByRole("button", { name: "Retry archived modules" }));
  await waitFor(() => expect(within(manager).queryByText("Archive membership refresh failed")).toBeNull());
  expect(writes).toBe(1);
});

it("[overhaul-649] ignores pre-archive project and archive collection responses after the canonical record and cascade membership converge", async () => {
  const boundary = moduleManagerArchiveBoundary();
  let releaseProject!: () => void;
  let releaseArchive!: () => void;
  let releaseStory!: () => void;
  const oldStory = new Promise<void>((resolve) => { releaseStory = resolve; });
  let staleStoryStarted = false;
  const oldProject = new Promise<void>((resolve) => { releaseProject = resolve; });
  const oldArchive = new Promise<void>((resolve) => { releaseArchive = resolve; });
  let delayProject = false;
  let archivedReads = 0;
  let staleProjectStarted = false;
  boundary.mount({ shell: true, selectedTaskId: null, children: <DialogHost />,
    graphQlExecute: async (document, variables) => {
      const operation = documentOperationName(document);
      if (operation === "WorkTrackerWorkItem" && (variables as { id: string }).id === "roadmap-24" && !staleStoryStarted) {
        staleStoryStarted = true;
        const stale = structuredClone(await boundary.execute(document, variables));
        await oldStory; return stale;
      }
      if (operation === "WorkTrackerProjectOpen" && delayProject) {
        delayProject = false; staleProjectStarted = true;
        const stale = structuredClone(await boundary.execute(document, variables));
        await oldProject; return stale;
      }
      if (operation === "ModuleManagerArchivedModules" && ++archivedReads === 1) {
        const stale = await boundary.execute(document, variables);
        await oldArchive; return stale;
      }
      return boundary.execute(document, variables);
    } });
  fireEvent.click(await screen.findByRole("button", { name: "Show all sprints" }));
  await screen.findByRole("tab", { name: "0.2.0" });
  fireEvent.click(screen.getByRole("button", { name: "Open Module Manager" }));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  await waitFor(() => expect(within(manager).getByRole("button", { name: "Archive Roadmap" })).toBeEnabled());
  delayProject = true;
  let delayedRead!: Promise<unknown>;
  act(() => { delayedRead = studioApolloClient().query({ query: WorkTrackerProjectOpenDocument,
    variables: { projectId: "project-1" }, fetchPolicy: "network-only", context: { queryDeduplication: false } }); });
  await waitFor(() => expect(staleProjectStarted).toBe(true));
  let delayedStory!: ReturnType<ReturnType<typeof studioApolloClient>["query"]>;
  act(() => { delayedStory = studioApolloClient().query({ query: WorkTrackerWorkItemDocument, variables: { id: "roadmap-24" },
    fetchPolicy: "network-only", context: { queryDeduplication: false } }); });
  await waitFor(() => expect(staleStoryStarted).toBe(true));
  fireEvent.click(within(manager).getByRole("button", { name: "Archive Roadmap" }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Archive module" }));
  await waitFor(() => expect(screen.queryByRole("tab", { name: "Roadmap" })).toBeNull());
  await within(manager).findByRole("button", { name: "Archived 1 modules" });
  await act(async () => { releaseArchive(); releaseProject(); releaseStory(); await delayedRead; });
  const restoredStory = await delayedStory;
  expect((restoredStory.data as { work_item: { nodes: Array<{ is_archived: boolean }> } }).work_item.nodes[0]?.is_archived).toBe(true);
  fireEvent.click(within(manager).getByRole("button", { name: "Archived 1 modules" }));
  expect(within(within(manager).getByRole("region", { name: "Archived" })).getByRole("button", { name: "Inspect Roadmap" })).toBeVisible();
  expect(screen.queryByRole("tab", { name: "Roadmap" })).toBeNull();
  expect(within(manager).queryByRole("button", { name: "Archive Roadmap" })).toBeNull();
  fireEvent.click(within(manager).getByRole("button", { name: "Close Module Manager" }));
  expect(screen.getByRole("tab", { name: "0.2.0" })).toHaveAttribute("aria-selected", "true");
});
