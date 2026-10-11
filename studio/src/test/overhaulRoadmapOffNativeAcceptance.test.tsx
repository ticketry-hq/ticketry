import { act, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { roadmapAvailabilityFixture } from "./roadmapAvailabilityFixture";
import { NATIVE_TERMINAL_CHORD_EVENT } from "../app/navigation/nativeTerminalChords";
import { registerNativeTerminalKeyboardOwner } from "../runtime/nativeTerminalKeyboard";
import { usePlanWorkspace } from "../features/sprints";
import { useTerminalStore } from "../features/agents/terminal";
import { useClientStore } from "../state/clientStore";
import { documentOperationName } from "../graphql-foundation/typedDocument";

const host = vi.hoisted(() => {
  const listeners = new Map<string, (event: unknown) => void>();
  return {
    listeners,
    listen: vi.fn(async (name: string, listener: (event: unknown) => void) => {
      listeners.set(name, listener);
      return () => listeners.delete(name);
    }),
  };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null), isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: host.listen }));

it("[overhaul-535] native host close and module navigation ignore stale OFF Plan ownership", async () => {
  host.listeners.clear();
  const f = roadmapAvailabilityFixture();
  const closed: unknown[] = [];
  f.mount({ graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) === "UpdateTerminalSession") {
      closed.push(variables);
      return { terminal_session: { __typename: "AgentTerminalSessions", agent_run_id: "run-retained" } } as never;
    }
    return f.execute(document, variables);
  } });
  await screen.findByRole("tab", { name: "Roadmap" });
  await waitFor(() => expect(host.listeners.has(NATIVE_TERMINAL_CHORD_EVENT)).toBe(true));
  act(() => {
    f.seedTerminal();
    usePlanWorkspace.setState({ active: true, projectId: "project-1", sprintId: "sprint-25", openItem: "suggestion:suggestion-25" });
  });
  const stop = registerNativeTerminalKeyboardOwner({ handle: "native-retained", runId: "run-retained" });
  const emit = (chord: string, handle = "native-retained") => host.listeners.get(NATIVE_TERMINAL_CHORD_EVENT)?.({
    payload: { handle, runId: "run-retained", chord },
  });
  try {
    act(() => emit("close-tab", "native-stale"));
    expect(closed).toEqual([]);
    act(() => emit("close-tab"));
    await waitFor(() => expect(useTerminalStore.getState().sessionByRun["run-retained"]).toBeUndefined());
    expect(closed).toEqual([expect.objectContaining({ agentRunId: "run-retained" })]);
    const secondModule = screen.getByRole("tablist", { name: "Project module tabs" }).querySelectorAll<HTMLElement>('[role="tab"][data-module-id]')[1];
    expect(secondModule).toBeDefined();
    act(() => emit("module-position-2"));
    await waitFor(() => expect(useClientStore.getState().selectedModuleId).toBe(secondModule.dataset.moduleId));
    expect(usePlanWorkspace.getState().openItem).toBe("suggestion:suggestion-25");
    expect(screen.queryByRole("tab", { name: "Plan" })).not.toBeInTheDocument();
    expect(f.calls.filter(({ operation }) => /^(Create|Update|Delete)(Sprint|Planning)|UpdateWorkTrackerModulePresentation/.test(operation))).toEqual([]);
  } finally {
    stop();
  }
});
