import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LaunchAgentAction } from "../app/shell/ticket-workspace/selected-ticket/details/LaunchAgentAction";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
  isTauri: () => true,
}));

vi.mock("../features/agents/terminal", () => ({
  launchFailureMessage: (error: unknown) => String(error),
}));

describe("Rust launch-policy acceptance", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    tauri.invoke.mockResolvedValue({
      target_id: "task-1",
      agent: "codex",
      agent_run_id: "run-1",
    });
  });

  it("[overhaul-81] routes the desktop launch action through Rust policy", async () => {
    render(<LaunchAgentAction issueId="task-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Run agent" }));

    await waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith(
        "desktop_launch_default_coding_agent",
        { issueId: "task-1" },
      );
    });
  });
});
