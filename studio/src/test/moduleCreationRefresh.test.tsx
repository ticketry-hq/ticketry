import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useStudioStore } from "../features/projects";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { moduleManagerCreationBoundary, openModuleCreation, fillModuleCreation } from "./moduleManagerCreationBoundary";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => command === "desktop_validate_module_folder"
    ? { valid: true, reason: null } : null,
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

it("creation refreshes module membership even while an older project read is pending", async () => {
  let holdNextProjectRead = false;
  let staleReadStarted = false;
  let releaseStale!: () => void;
  const staleGate = new Promise<void>((resolve) => { releaseStale = resolve; });
  const f = moduleManagerCreationBoundary({ wrapExecute: (execute) => async (document, variables) => {
    const operation = documentOperationName(document);
    if (operation === "WorkTrackerProjectOpen" && holdNextProjectRead) {
      holdNextProjectRead = false;
      const beforeCreation = structuredClone(await execute(document, variables));
      staleReadStarted = true;
      await staleGate;
      return beforeCreation;
    }
    const result = await execute(document, variables);
    if (operation === "CreateWorkTrackerWorkItem") {
      // An old background response arrives after creation and its post-write
      // refresh has had an opportunity to start. A fresh read returns later.
      setTimeout(releaseStale, 100);
    }
    if (operation === "WorkTrackerProjectOpen" && staleReadStarted) {
      await staleGate;
      await Promise.resolve();
    }
    return result;
  } });
  const manager = await openModuleCreation();
  fillModuleCreation(manager);
  holdNextProjectRead = true;
  const oldRefresh = useStudioStore.getState().reloadModules();
  await waitFor(() => expect(staleReadStarted).toBe(true));
  try {
    fireEvent.click(within(manager).getByRole("button", { name: "Create module" }));
    await act(async () => { await oldRefresh; });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Module Manager" })).toBeNull());
    expect(screen.getByRole("button", { name: "Open Module Manager" })).toHaveTextContent("4");
    const tabs = within(screen.getByRole("tablist", { name: "Project module tabs" })).getAllByRole("tab", {
      name: /^(Roadmap|0\.2\.0|Fresh module)$/,
    });
    expect(tabs.map((tab) => tab.getAttribute("aria-label"))).toEqual(["Roadmap", "0.2.0", "Fresh module"]);
    expect(screen.getByRole("tab", { name: "Fresh module" })).toHaveAttribute("aria-selected", "true");
    expect(f.writes.filter(({ operation }) => operation === "CreateWorkTrackerWorkItem")).toHaveLength(1);
  } finally {
    releaseStale();
  }
});

it("a failed post-create membership read stays retryable without creating another module", async () => {
  let created = false;
  let refuseMembership = true;
  const f = moduleManagerCreationBoundary({ wrapExecute: (execute) => async (document, variables) => {
    const operation = documentOperationName(document);
    if (operation === "WorkTrackerProjectOpen" && created && refuseMembership) throw new Error("Membership unavailable");
    const result = await execute(document, variables);
    if (operation === "CreateWorkTrackerWorkItem") created = true;
    return result;
  } });
  const manager = await openModuleCreation();
  fillModuleCreation(manager);
  fireEvent.click(within(manager).getByRole("button", { name: "Create module" }));
  const form = within(manager).getByRole("form", { name: "Create module" });
  expect(await within(form).findByRole("alert")).toHaveTextContent(/Module created.*list.*Retry/);
  expect(manager).toBeVisible();
  expect(screen.queryByRole("tab", { name: "Fresh module" })).toBeNull();
  refuseMembership = false;
  fireEvent.click(within(form).getByRole("button", { name: /Save folder|Finish setup/ }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Module Manager" })).toBeNull());
  expect(screen.getByRole("button", { name: "Open Module Manager" })).toHaveTextContent("4");
  expect(screen.getByRole("tab", { name: "Fresh module" })).toHaveAttribute("aria-selected", "true");
  expect(f.writes.filter(({ operation }) => operation === "CreateWorkTrackerWorkItem")).toHaveLength(1);
});
