import { describe, expect, expectTypeOf, it } from "vitest";
import type { LaunchBinding, ScopedWorkflowLaunchBinding } from "./types";
import { canAutoLaunchTo, launchBindingsByStateId } from "./launchBindingValidation";

const binding: LaunchBinding = {
  id: 1, issue_type: "type-a", state: "state-a", prompt: "Implement", profile: null,
  required_skills: [], stage_skills: [], model: "model-id", reasoning: null,
  auto_start: true, subtree_run_enabled: false, created_at: "", updated_at: "",
  state_record: null,
};

describe("launch binding validation", () => {
  it("indexes generated binding identities within the selected issue type", () => {
    const other = { ...binding, id: 2, issue_type: "type-b" };
    expect([...launchBindingsByStateId([binding, other], "type-a")]).toEqual([["state-a", binding]]);
    expect(launchBindingsByStateId([binding], null).size).toBe(0);
  });

  it("validates auto-launch against resolved scoped provider and model choices", () => {
    expectTypeOf<Parameters<typeof canAutoLaunchTo>[0]>().toEqualTypeOf<ScopedWorkflowLaunchBinding | undefined>();
    const scoped: ScopedWorkflowLaunchBinding = {
      state_id: "state-a", prompt: "Implement", required_skills: [], stage_skills: [],
      agent: "codex", profile: null, model: "model", reasoning: "high",
      auto_start: true, subtree_run_enabled: false,
    };
    const capabilities = [{ agent: "codex", accepts_model: true, accepts_any_model: false, model_aliases: ["model"], reasoning_levels: ["high"] }];
    expect(canAutoLaunchTo(scoped, capabilities)).toBe(true);
    expect(canAutoLaunchTo({ ...scoped, prompt: "  " }, capabilities)).toBe(false);
    expect(canAutoLaunchTo({ ...scoped, agent: null }, capabilities)).toBe(false);
    expect(canAutoLaunchTo({ ...scoped, model: "unavailable" }, capabilities)).toBe(false);
    expect(canAutoLaunchTo(scoped, [])).toBe(false);
    expect(canAutoLaunchTo(undefined, capabilities)).toBe(false);
  });

});
