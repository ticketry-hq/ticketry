import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOnboardingTourStore } from "../app/onboarding/onboardingTourStore";
import { WorkTrackerOnboardingDocument } from "../features/projects/generated/projects.documents";
import { studioApolloClient } from "../shared/apollo/client";
import { compactWorktrackerId } from "../shared/api/generatedWorktracker";
import { useClientStore } from "../state/clientStore";
import {
  createFirstModule,
  DurableOnboardingBoundary,
  installBoundary,
  MODULE_ID,
  mountApplication,
  PROJECT_ID,
  resetClientRuntime,
} from "./onboardingJourneyFixture";

/** Story-only tour steps that a project without a Story type must never show. */
const STORY_STEP_TEXT = [
  "Create your first story",
  "Your first story is ready",
  "Story workflow guide",
];

function watchForStorySteps(): { seen: () => string[]; stop: () => void } {
  const seen = new Set<string>();
  const scan = () => {
    const text = document.body.textContent ?? "";
    for (const step of STORY_STEP_TEXT) if (text.includes(step)) seen.add(step);
  };
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return { seen: () => [...seen], stop: () => observer.disconnect() };
}

describe("core first-run onboarding without a Story type", () => {
  beforeEach(async () => {
    Element.prototype.scrollIntoView = vi.fn();
    localStorage.clear();
    await studioApolloClient().clearStore();
    resetClientRuntime();
  });

  it("[CODING-2861] offers Finish tour right after the first module and never renders Story steps", async () => {
    const boundary = new DurableOnboardingBoundary("core");
    installBoundary(boundary);
    mountApplication();
    const storySteps = watchForStorySteps();

    await createFirstModule("none");

    const ready = await screen.findByRole("dialog", { name: "Your first module is ready" });
    expect(ready).toHaveTextContent(/no Story type/i);
    expect(screen.getByRole("button", { name: "Finish tour" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Skip tour" })).not.toBeInTheDocument();
    await waitFor(() => expect(useClientStore.getState().selectedModuleId).toBe(MODULE_ID));
    expect(boundary.linkedFolder).toBe("/repos/ticketry");
    expect(boundary.createdNames).toEqual(["Onboarding module"]);
    expect(boundary.acknowledgementAttempts).toBe(0);

    storySteps.stop();
    expect(storySteps.seen()).toEqual([]);
  });

  it("[CODING-2861] persists acknowledgement on Finish tour and does not show the tour after remount", async () => {
    const boundary = new DurableOnboardingBoundary("core");
    installBoundary(boundary);
    const firstRun = mountApplication();
    const storySteps = watchForStorySteps();

    await createFirstModule("none");
    fireEvent.click(await screen.findByRole("button", { name: "Finish tour" }));

    await waitFor(() => expect(useOnboardingTourStore.getState().step).toBe("inactive"));
    expect(screen.queryByRole("dialog", { name: "Your first module is ready" })).not.toBeInTheDocument();
    expect(boundary.acknowledgementProjectIds).toEqual([PROJECT_ID]);
    storySteps.stop();
    expect(storySteps.seen()).toEqual([]);

    const readBack = await studioApolloClient().query({
      query: WorkTrackerOnboardingDocument,
      fetchPolicy: "network-only",
    });
    expect(readBack.data?.projects.nodes).toHaveLength(1);
    expect(compactWorktrackerId(readBack.data!.projects.nodes[0].id)).toBe(compactWorktrackerId(PROJECT_ID));
    expect(readBack.data!.projects.nodes[0]).toMatchObject({ onboarding_required: false });

    firstRun.unmount();
    await studioApolloClient().clearStore();
    resetClientRuntime();
    mountApplication();

    expect(await screen.findByRole("tab", { name: "Onboarding module" })).toBeVisible();
    expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
    expect(screen.queryByText("Add your first module")).not.toBeInTheDocument();
    expect(screen.queryByText("Your first module is ready")).not.toBeInTheDocument();
    expect(boundary.acknowledgementAttempts).toBe(1);
  });
});
