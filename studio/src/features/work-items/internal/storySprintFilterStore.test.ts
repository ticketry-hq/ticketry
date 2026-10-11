import { describe, expect, it } from "vitest";

import { getStorySprintFilterIntent, setStorySprintFilterIntent } from "./storySprintFilterStore";
import { resetStudioApolloClient } from "../../../shared/apollo/client";

describe("project-session Stories sprint intent", () => {
  it("starts Active and remembers each project's explicit choice across revisits", () => {
    expect(getStorySprintFilterIntent("project-a")).toEqual({ mode: "active" });
    setStorySprintFilterIntent("project-a", { mode: "id", sprintId: "sprint-a" });
    expect(getStorySprintFilterIntent("project-b")).toEqual({ mode: "active" });
    setStorySprintFilterIntent("project-b", { mode: "none" });
    expect(getStorySprintFilterIntent("project-a")).toEqual({ mode: "id", sprintId: "sprint-a" });
    expect(getStorySprintFilterIntent("project-b")).toEqual({ mode: "none" });
  });
  it("returns to Active after the application cache is replaced for a new session", async () => {
    setStorySprintFilterIntent("project-a", { mode: "all" });
    await resetStudioApolloClient();
    expect(getStorySprintFilterIntent("project-a")).toEqual({ mode: "active" });
  });
  it("retains one project choice across compact and public identity spellings", () => {
    setStorySprintFilterIntent("11111111111111111111111111111111", {
      mode: "id", sprintId: "22222222222222222222222222222222",
    });
    expect(getStorySprintFilterIntent("11111111-1111-1111-1111-111111111111")).toEqual({
      mode: "id", sprintId: "22222222-2222-2222-2222-222222222222",
    });
  });
});
