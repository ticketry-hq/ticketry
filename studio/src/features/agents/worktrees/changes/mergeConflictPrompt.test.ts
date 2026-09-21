import { describe, expect, it } from "vitest";

import { buildMergeConflictPrompt } from "./mergeConflictPrompt";

describe("buildMergeConflictPrompt", () => {
  it("names the checkout, both branches, and every conflicted path", () => {
    const prompt = buildMergeConflictPrompt({
      taskId: "task-1",
      sourceBranch: "wt/CODIN-2042",
      destinationBranch: "main",
      destinationCheckout: "/repo/agents",
      unmergedPaths: ["core/pi_model.py", "tests/test_agent.py"],
    });
    expect(prompt).toContain("task-1");
    expect(prompt).toContain("wt/CODIN-2042 into main");
    expect(prompt).toContain("/repo/agents");
    expect(prompt).toContain("- core/pi_model.py");
    expect(prompt).toContain("- tests/test_agent.py");
  });

  it("keeps a usable prompt when Git reported no paths", () => {
    const prompt = buildMergeConflictPrompt({
      taskId: "task-1",
      sourceBranch: "a",
      destinationBranch: "b",
      destinationCheckout: "/repo",
      unmergedPaths: [],
    });
    expect(prompt).toContain("git status");
  });
});
