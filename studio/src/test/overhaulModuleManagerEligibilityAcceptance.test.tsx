import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { useClientStore } from "../state/clientStore";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";

it("[overhaul-618] disables definitive navigation during incomplete eligibility and retries the generated membership read before restoring and opening", async () => {
  const boundary = storySprintModuleBoundary();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let membershipReads = 0;
  boundary.mount({ shell: true, selectedTaskId: null, graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) !== "ProjectStorySprintIndex") return boundary.execute(document, variables);
    membershipReads += 1;
    const first = membershipReads === 1;
    if (first) await pending;
    const data = await boundary.execute(document, variables) as any;
    return first ? { ...data, roots: { ...data.roots, nodes: data.roots.nodes.slice(0, 1),
      pageInfo: { ...data.roots.pageInfo, hasNextPage: true } } } : data;
  } });
  await waitFor(() => expect(membershipReads).toBe(1));
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  expect(within(manager).getByText(/Loading module eligibility/)).toBeVisible();
  expect(within(manager).getByRole("button", { name: "Open 0.2.0" })).toBeDisabled();
  expect(within(manager).getByRole("button", { name: "Restore bugs" })).toBeDisabled();
  expect(within(manager).getByRole("region", { name: "Not in sprint" })).not.toHaveTextContent("0.2.0");
  fireEvent.click(within(manager).getByRole("button", { name: "Restore bugs" }));
  fireEvent.click(within(manager).getByRole("button", { name: "Open 0.2.0" }));
  expect(useClientStore.getState().selectedModuleId).toBe("module-1");
  expect(boundary.calls.filter(({ operation }) => operation === "UpdateWorkTrackerModulePresentation")).toEqual([]);
  await act(async () => { release(); await pending; });
  fireEvent.click(await within(manager).findByRole("button", { name: "Retry module eligibility" }));
  await waitFor(() => expect(membershipReads).toBeGreaterThan(1));
  await waitFor(() => expect(within(manager).getByRole("button", { name: "Restore bugs" })).toBeEnabled());
  expect(within(manager).getByRole("region", { name: "Not in sprint" })).toHaveTextContent("0.2.0");
  fireEvent.click(within(manager).getByRole("button", { name: "Restore bugs" }));
  await within(manager).findByRole("button", { name: "Open bugs" });
  expect(screen.getByRole("region", { name: "Module Manager" })).toBeVisible();
  expect(useClientStore.getState().selectedModuleId).toBe("module-1");
  fireEvent.click(within(manager).getByRole("button", { name: "Open bugs" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Module Manager" })).toBeNull());
  expect(screen.getByRole("tab", { name: "bugs" })).toHaveAttribute("aria-selected", "true");
  expect(boundary.calls.filter(({ operation }) => operation === "UpdateWorkTrackerModulePresentation")).toEqual([
    { operation: "UpdateWorkTrackerModulePresentation", variables: { moduleId: "module-2", tabHidden: false } },
  ]);
});
