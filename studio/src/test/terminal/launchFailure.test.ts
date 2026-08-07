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

  it("renders every actionable required-skill rejection field", () => {
    expect(
      launchFailureMessage({
        body: {
          code: "required_skill_unavailable",
          provider: "claude",
          skill: "grilling",
          reason: "collision",
          detail: "A different provider-visible skill already reserves 'grilling'.",
          remediation: "Rename the provider-visible skill, then retry.",
          retryable: false,
        },
      }),
    ).toBe(
      "Required skill 'grilling' is unavailable for claude (collision): "
        + "A different provider-visible skill already reserves 'grilling'. "
        + "Next action: Rename the provider-visible skill, then retry.",
    );
  });
});
