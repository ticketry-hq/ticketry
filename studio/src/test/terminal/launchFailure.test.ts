import { describe, expect, it } from "vitest";

import { launchFailureMessage } from "../../features/agents/terminal/internal/launchFailure";


describe("launchFailureMessage", () => {
  it("shows the backend launch message when the control plane supplies one", () => {
    expect(
      launchFailureMessage({
        body: {
          detail: {
            error: "launch_unavailable",
            message: "new-session failed: tmux server exited",
          },
        },
      }),
    ).toBe("Launch unavailable: new-session failed: tmux server exited");
  });
});
