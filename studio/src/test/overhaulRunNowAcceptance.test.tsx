import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { studioKeymapRegistry } from "../app/navigation/keymapRegistry";
import { useTerminalStore } from "../features/agents/terminal/appNavigation";
import { KeyboardSettingsPanel } from "../features/studio/modals/KeyboardSettingsPanel";
import { useClientStore } from "../state/clientStore";
import { fixture, mountStudio, workItem } from "./seam";

const ideas = {
  id: "ideas",
  name: "Ideas",
  group: "backlog",
  color: null,
};
const implement = {
  id: "implement",
  name: "Implement",
  group: "started",
  color: null,
};
const tickets = {
  id: "tickets",
  name: "Tickets",
  group: "unstarted",
  color: null,
};

function RunNowAcceptanceSurface() {
  useGlobalKeymap();
  return (
    <KeyboardSettingsPanel
      bindings={studioKeymapRegistry.getConfigurableBindings()}
      overridden={new Set()}
      recordingKey={null}
      message={null}
      saving={false}
      onRecord={vi.fn()}
      onReset={vi.fn()}
      onRestoreDefaults={vi.fn()}
    />
  );
}

function hasToast(kind: "success" | "error", text: string): boolean {
  return useClientStore
    .getState()
    .toasts.some((toast) => toast.kind === kind && toast.message.includes(text));
}

describe("overhaul acceptance — Run Now", () => {
  it("[overhaul-134] runs eligible Ideas from Details or r with one guarded request and follows workflow refreshes", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: [
        "click-idea",
        "key-idea",
        "refusal-idea",
        "refresh-idea",
        "ticketed-story",
        "implementation-idea",
      ],
      children: {
        "click-idea": [],
        "key-idea": [],
        "refusal-idea": [],
        "refresh-idea": [],
        "ticketed-story": [],
        "implementation-idea": [],
      },
      order: [
        "click-idea",
        "key-idea",
        "refusal-idea",
        "refresh-idea",
        "ticketed-story",
        "implementation-idea",
      ],
    });
    http.workItems([
      workItem({ id: "click-idea", name: "Click idea", state: ideas }),
      workItem({ id: "key-idea", name: "Keyboard idea", state: ideas }),
      workItem({ id: "refusal-idea", name: "Refusal idea", state: ideas }),
      workItem({ id: "refresh-idea", name: "Refresh idea", state: ideas }),
      workItem({ id: "ticketed-story", name: "Ticketed story", state: tickets }),
      workItem({
        id: "implementation-idea",
        name: "Implementation idea",
        state: ideas,
        issue_type: {
          id: "implementation",
          name: "Implementation",
          level: "task",
          color: null,
          sort_order: 2,
        },
      }),
      workItem({ id: "state-catalog", name: "State catalog", state: implement }),
    ]);
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    mountStudio({
      http,
      selectedTaskId: "click-idea",
      children: <RunNowAcceptanceSurface />,
    });

    const details = await screen.findByRole("region", { name: "Details" });
    const runNow = await within(details).findByRole("button", { name: "Run now" });
    expect(runNow).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("button", { name: "Record Run now binding" }))
      .toHaveTextContent("R");

    const release = http.holdRunNow();
    fireEvent.click(runNow);
    fireEvent.click(runNow);
    await waitFor(() => expect(http.runNowCount("click-idea")).toBe(1));
    expect(runNow).toBeDisabled();
    expect(runNow).toHaveAttribute("aria-busy", "true");
    expect(runNow).toHaveTextContent("Running now…");
    release();

    await waitFor(() =>
      expect(useClientStore.getState().workspaces["click-idea"]?.active)
        .toBe("terminal"),
    );
    expect(useTerminalStore.getState().sessionByRun["run-now-click-idea"])
      .toBeTruthy();
    expect(hasToast("success", "Run now started.")).toBe(true);

    useClientStore.getState().selectTask("key-idea");
    await within(details).findByRole("button", { name: "Run now" });
    http.failNextRunNow(409, {
      target_id: "key-idea",
      committed_state: null,
      run: null,
      detail: "An agent is already running for this Story. Close it before trying again.",
      code: "task_already_active",
    });
    fireEvent.keyDown(window, { key: "r" });
    await waitFor(() => expect(http.runNowCount("key-idea")).toBe(1));
    await waitFor(() =>
      expect(hasToast("error", "Close its terminal before trying again."))
        .toBe(true),
    );
    expect(hasToast("success", "Keyboard idea")).toBe(false);
    expect(useClientStore.getState().workspaces["key-idea"]?.active)
      .not.toBe("terminal");

    fireEvent.keyDown(window, { key: "r" });
    await waitFor(() =>
      expect(useClientStore.getState().workspaces["key-idea"]?.active)
        .toBe("terminal"),
    );
    expect(http.runNowCount("key-idea")).toBe(2);

    useClientStore.getState().selectTask("refusal-idea");
    const refusalRunNow = await within(details).findByRole("button", { name: "Run now" });
    http.failNextRunNow(409, {
      target_id: "refusal-idea",
      committed_state: null,
      run: null,
      code: "required_skill_unavailable",
      provider: "codex",
      skill: "research",
      reason: "unknown",
      detail: "The required skill is not packaged.",
      remediation: "Choose a packaged skill, then retry.",
    });
    fireEvent.click(refusalRunNow);
    await waitFor(() =>
      expect(hasToast(
        "error",
        "Required skill 'research' is unavailable for codex (unknown): "
          + "The required skill is not packaged. "
          + "Next action: Choose a packaged skill, then retry.",
      )).toBe(true),
    );
    expect(useClientStore.getState().workspaces["refusal-idea"]?.active)
      .not.toBe("terminal");

    http.failNextRunNow(422, {
      target_id: "refusal-idea",
      committed_state: null,
      run: null,
      detail: "binding_not_configured",
      code: "binding_not_configured",
    });
    fireEvent.click(refusalRunNow);
    await waitFor(() =>
      expect(hasToast(
        "error",
        "Configure an Implement launch binding before trying again.",
      )).toBe(true),
    );
    expect(http.runNowCount("refusal-idea")).toBe(2);

    http.failNextRunNow(503, {
      target_id: "refusal-idea",
      committed_state: { id: "implement", name: "Implement" },
      run: null,
      detail: "launch_unavailable",
      code: "launch_unavailable",
    });
    fireEvent.click(refusalRunNow);
    await waitFor(() =>
      expect(within(details).queryByRole("button", { name: "Run now" }))
        .toBeNull(),
    );
    expect(http.runNowCount("refusal-idea")).toBe(3);

    useClientStore.getState().selectTask("ticketed-story");
    await waitFor(() =>
      expect(within(details).queryByRole("button", { name: "Run now" }))
        .toBeNull(),
    );
    fireEvent.keyDown(window, { key: "r" });
    expect(http.runNowCount("ticketed-story")).toBe(0);

    useClientStore.getState().selectTask("implementation-idea");
    await waitFor(() =>
      expect(within(details).queryByRole("button", { name: "Run now" }))
        .toBeNull(),
    );
    fireEvent.keyDown(window, { key: "r" });
    expect(http.runNowCount("implementation-idea")).toBe(0);

    useClientStore.getState().selectTask("refresh-idea");
    await within(details).findByRole("button", { name: "Run now" });
    http.setRunNowTransitionEnabled(false);
    await http.refreshRunNowCapabilities("story");
    await waitFor(() =>
      expect(within(details).queryByRole("button", { name: "Run now" }))
        .toBeNull(),
    );
    fireEvent.keyDown(window, { key: "r" });
    expect(http.runNowCount("refresh-idea")).toBe(0);
  });
});
