import { describe, expect, it } from "vitest";

import { launchFailureMessage } from "../../features/agents/terminal/internal/launchFailure";


describe("launchFailureMessage", () => {
  const guidance = "To run agent work, activate a provider in Settings > Model configuration. "
    + "You can keep planning without one.";

  it("shows planning guidance for known zero-provider refusals", () => {
    expect(launchFailureMessage({ body: { code: "no_activated_providers" } }))
      .toBe(guidance);
    expect(launchFailureMessage({ body: { detail: "No activated providers." } }))
      .toBe(guidance);
    expect(launchFailureMessage(new Error("No activated providers are configured.")))
      .toBe(guidance);
    expect(launchFailureMessage(new Error(
      "no_activated_providers: No activated providers are configured.",
    ))).toBe(guidance);
  });

  it("translates bare rejection codes returned by desktop launches", () => {
    expect(launchFailureMessage("no_activated_providers")).toBe(guidance);
    expect(launchFailureMessage("provider_not_activated"))
      .toContain("this launch configuration names a provider that is deactivated");
  });

  it("keeps inactive binding and missing default refusals specific", () => {
    expect(launchFailureMessage({ body: { code: "provider_not_activated" } }))
      .toContain("this launch configuration names a provider that is deactivated");
    expect(launchFailureMessage(new Error(
      "Choose a default model in Settings before starting a conversation.",
    ))).toBe("Choose a default model in Settings before starting a conversation.");
    expect(launchFailureMessage(new Error("module_folder_unusable")))
      .toBe("module_folder_unusable");
  });

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

  it("reads the flat error code returned by execution endpoints", () => {
    expect(
      launchFailureMessage({
        body: {
          detail: "no_profile_selected",
          code: "no_profile_selected",
        },
      }),
    ).toBe("Select a Studio launch profile before trying again.");
  });

  it("translates the previous-agent refusal into a retry remedy", () => {
    expect(
      launchFailureMessage({ body: { detail: "previous_agent_not_ended" } }),
    ).toBe(
      "The previous agent could not be ended. Close its terminal session, "
        + "then try again.",
    );
  });
});
