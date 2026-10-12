import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  STORY_ID,
  type ProviderChoice,
} from "./onboardingJourneyFixture";

async function reachStoryCoachMark(choice: ProviderChoice): Promise<HTMLElement> {
  await createFirstModule(choice);
  return screen.findByRole("textbox", {
    name: "Capture an idea",
  });
}

async function reachFinalCoachMark(choice: ProviderChoice): Promise<HTMLElement> {
  const capture = await reachStoryCoachMark(choice);
  fireEvent.change(capture, { target: { value: "Keep my selected story" } });
  fireEvent.keyDown(capture, { key: "Enter" });

  const finish = await screen.findByRole("button", { name: "Finish tour" });
  await expectSelectedOnboardingStory();
  return finish;
}

async function expectSelectedOnboardingStory(): Promise<void> {
  await waitFor(() => expect(useClientStore.getState()).toMatchObject({
    selectedModuleId: MODULE_ID,
    selectedTaskId: STORY_ID,
  }));
  expect(await screen.findByRole("treeitem", {
    name: /Keep my selected story/,
  })).toHaveAttribute("aria-selected", "true");
}

function expectNoLaunchOperations(boundary: DurableOnboardingBoundary): void {
  expect(boundary.operations).not.toContain("CreateTerminalSession");
  expect(boundary.operations).not.toContain("CreateExecutionGraphRun");
  expect(boundary.operations).not.toContain("RunWorkTrackerWorkItemNow");
  expect(boundary.operations).not.toContain("TransitionWorkTrackerWorkItem");
  expect(boundary.operations).not.toContain("UpdateWorkTrackerWorkItem");
}

function expectCreatedContentOnce(boundary: DurableOnboardingBoundary): void {
  expect(boundary.operations.filter((operation) =>
    operation === "CreateWorkTrackerWorkItem"
  )).toHaveLength(2);
}

function watchForWelcome(): { returned: () => boolean; stop: () => void } {
  let welcomeReturned = false;
  const selector = '[data-testid="onboarding-welcome"]';
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (
          node instanceof Element
          && (node.matches(selector) || node.querySelector(selector))
        ) {
          welcomeReturned = true;
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return {
    returned: () => welcomeReturned,
    stop: () => observer.disconnect(),
  };
}

describe("completed onboarding workspace acceptance", () => {
  beforeEach(async () => {
    Element.prototype.scrollIntoView = vi.fn();
    localStorage.clear();
    await studioApolloClient().clearStore();
    resetClientRuntime();
  });

  it("[overhaul-386] connects a captured Story to its Details planning step without launching", async () => {
    const boundary = new DurableOnboardingBoundary();
    installBoundary(boundary);
    mountApplication();

    await reachFinalCoachMark("none");

    const handoff = screen.getByRole("dialog", {
      name: "Your first story is ready",
    });
    expect(handoff).toHaveTextContent(/Capturing this Story saved your work/i);
    expect(handoff).toHaveTextContent(/did not start an agent/i);
    expect(handoff).toHaveTextContent(/Details.*desired result.*finished/i);
    await expectSelectedOnboardingStory();
    expect(boundary.acknowledgementAttempts).toBe(0);
    expectCreatedContentOnce(boundary);
    expect(boundary.linkedFolder).toBe("/repos/ticketry");
    expectNoLaunchOperations(boundary);
  });

  it.each([
    ["zero providers", "none"],
    ["selected Codex without a stage binding", "codex"],
  ] as const)(
    "[overhaul-387] offers %s a useful handoff and optional shared guide without acknowledging or launching",
    async (_label, choice) => {
      const boundary = new DurableOnboardingBoundary();
      installBoundary(boundary);
      mountApplication();

      await reachFinalCoachMark(choice);
      const handoff = screen.getByRole("dialog", {
        name: "Your first story is ready",
      });
      expect(handoff).toHaveTextContent(/Details.*desired result.*finished/i);
      if (choice === "none") {
        expect(handoff).toHaveTextContent(/keep editing and organizing/i);
        expect(handoff).toHaveTextContent(/Settings.*Model configuration/i);
      } else {
        expect(handoff).toHaveTextContent(/launch configuration/i);
        expect(handoff).not.toHaveTextContent(/Run now/i);
      }

      fireEvent.click(within(handoff).getByRole("button", {
        name: "Story workflow guide",
      }));
      const guide = await screen.findByRole("dialog", {
        name: "Story workflow guide",
      });
      expect(screen.queryByRole("dialog", {
        name: "Your first story is ready",
      })).not.toBeInTheDocument();
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(guide).toHaveTextContent(/Details.*desired result.*finished/i);
      expect(guide).toHaveTextContent(/Finding results/);
      expect(useOnboardingTourStore.getState().step).toBe("handoff");
      expect(boundary.acknowledgementAttempts).toBe(0);
      await expectSelectedOnboardingStory();
      expectNoLaunchOperations(boundary);

      fireEvent.click(within(guide).getByRole("button", { name: "Close" }));
      const restored = await screen.findByRole("dialog", {
        name: "Your first story is ready",
      });
      await waitFor(() => expect(within(restored).getByRole("button", {
        name: "Story workflow guide",
      })).toHaveFocus());
      expect(within(restored).getByRole("button", { name: "Finish tour" }))
        .toBeEnabled();
      expect(boundary.providerChoice).toBe(choice);
      expect(boundary.acknowledgementAttempts).toBe(0);
      expect(boundary.operations.filter((operation) =>
        operation === "UpdateProviderCatalog"
      )).toHaveLength(1);
      expectCreatedContentOnce(boundary);
      expect(boundary.linkedFolder).toBe("/repos/ticketry");
      expectNoLaunchOperations(boundary);
    },
  );

  it("[overhaul-390] explains a configured current-stage Run item without promising launch readiness", async () => {
    const boundary = new DurableOnboardingBoundary();
    boundary.currentStageBinding = true;
    installBoundary(boundary);
    mountApplication();

    await reachFinalCoachMark("codex");
    const handoff = screen.getByRole("dialog", {
      name: "Your first story is ready",
    });
    await waitFor(() => {
      expect(handoff).toHaveTextContent(/Run item starts configured work.*current stage/i);
    });
    expect(handoff).toHaveTextContent(/launch binding is configured/i);
    expect(handoff).toHaveTextContent(/executable.*login.*profile.*backend checks/i);
    expect(handoff).not.toHaveTextContent(/Run now/i);
    expect(boundary.providerChoice).toBe("codex");
    expect(boundary.acknowledgementAttempts).toBe(0);
    await expectSelectedOnboardingStory();
    expectCreatedContentOnce(boundary);
    expectNoLaunchOperations(boundary);
  });

  it("[overhaul-389] lets Finish tour succeed after optional workflow help fails to load", async () => {
    const boundary = new DurableOnboardingBoundary();
    installBoundary(boundary);
    mountApplication();
    await reachFinalCoachMark("none");

    boundary.failProjectOpen = true;
    const handoff = screen.getByRole("dialog", {
      name: "Your first story is ready",
    });
    fireEvent.click(within(handoff).getByRole("button", {
      name: "Story workflow guide",
    }));
    const guide = await screen.findByRole("dialog", {
      name: "Story workflow guide",
    });
    expect(await within(guide).findByRole("alert")).toHaveTextContent(
      /Workflow configuration could not load/,
    );
    expect(guide).not.toHaveTextContent("Next: Grill");
    expect(boundary.acknowledgementAttempts).toBe(0);
    fireEvent.click(within(guide).getByRole("button", { name: "Close" }));
    boundary.failProjectOpen = false;

    const finish = await screen.findByRole("button", { name: "Finish tour" });
    fireEvent.click(finish);
    await waitFor(() => expect(boundary.onboardingRequired).toBe(false));
    expect(boundary.acknowledgementProjectIds).toEqual([PROJECT_ID]);
    expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
    await expectSelectedOnboardingStory();
    expectCreatedContentOnce(boundary);
    expectNoLaunchOperations(boundary);
  });

  it.each([
    ["zero providers", "none"],
    ["selected Codex", "codex"],
  ] as const)(
    "[overhaul-372] teaches Ticketry and Story capture without creating the example for %s",
    async (_label, choice) => {
      const boundary = new DurableOnboardingBoundary();
      installBoundary(boundary);
      mountApplication();

      const welcome = await screen.findByTestId("onboarding-welcome");
      const providerHeading = await within(welcome).findByRole("heading", {
        name: "Your agents",
      });
      const introduction = within(welcome).getByText(/Ticketry helps you turn ideas into planned work/);
      expect(introduction.compareDocumentPosition(providerHeading) & Node.DOCUMENT_POSITION_FOLLOWING)
        .toBeTruthy();
      expect(welcome).toHaveTextContent(/run coding agents when you choose/);
      expect(welcome).toHaveTextContent(/review their changes/);
      expect(welcome).toHaveTextContent(/plan without an agent provider/);

      const capture = await reachStoryCoachMark(choice);
      expect(screen.getByText(/A Story describes a change you want to make and why it matters/))
        .toBeVisible();
      expect(screen.getByText(/Add a search box so people can find saved notes/))
        .toBeVisible();
      expect(screen.getByText(/real idea field and press Enter/)).toBeVisible();
      expect(capture).toHaveValue("");
      expect(boundary.createdNames).toEqual(["Onboarding module"]);
      expect(boundary.storyCreated).toBe(false);
      expectNoLaunchOperations(boundary);

      fireEvent.change(capture, { target: { value: "Keep my selected story" } });
      fireEvent.keyDown(capture, { key: "Enter" });
      await screen.findByRole("button", { name: "Finish tour" });
      await expectSelectedOnboardingStory();
      expect(boundary.createdNames).toEqual([
        "Onboarding module",
        "Keep my selected story",
      ]);
      expect(boundary.providerChoice).toBe(choice);
      expectNoLaunchOperations(boundary);
    },
  );

  it.each([
    ["zero providers", "none"],
    ["selected Codex", "codex"],
  ] as const)(
    "[overhaul-388] reopens the same Story guide from Details after %s completion and completed-state bootstrap",
    async (_label, choice) => {
      const boundary = new DurableOnboardingBoundary();
      installBoundary(boundary);
      const firstRun = mountApplication();
      const finish = await reachFinalCoachMark(choice);
      fireEvent.click(finish);
      await waitFor(() => expect(boundary.onboardingRequired).toBe(false));
      firstRun.unmount();
      await studioApolloClient().clearStore();
      resetClientRuntime();
      mountApplication();

      await expectSelectedOnboardingStory();
      expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
      expect(useOnboardingTourStore.getState().step).toBe("inactive");
      const details = await screen.findByRole("region", { name: "Details" });
      const toolbarGuide = within(details).getByRole("button", {
        name: "Story workflow guide",
      });
      toolbarGuide.focus();
      fireEvent.click(toolbarGuide);
      const guide = await screen.findByRole("dialog", {
        name: "Story workflow guide",
      });
      expect(guide).toHaveTextContent("For Story: Keep my selected story");
      expect(guide).toHaveTextContent(/Details.*desired result.*finished/i);
      expect(boundary.acknowledgementAttempts).toBe(1);
      expectNoLaunchOperations(boundary);
      fireEvent.keyDown(guide, { key: "Escape" });
      await waitFor(() => expect(guide).not.toBeInTheDocument());
      await waitFor(() => expect(toolbarGuide).toHaveFocus());
      expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
      expect(useOnboardingTourStore.getState().step).toBe("inactive");
      expect(boundary.providerChoice).toBe(choice);
      expectCreatedContentOnce(boundary);
      expectNoLaunchOperations(boundary);
    },
  );

  it.each([
    ["zero providers", "none"],
    ["selected Codex", "codex"],
  ] as const)(
    "[overhaul-370] keeps the created module and selected Story through %s onboarding completion and reload",
    async (_label, choice) => {
      const boundary = new DurableOnboardingBoundary();
      installBoundary(boundary);
      const firstRun = mountApplication();
      const finish = await reachFinalCoachMark(choice);
      const welcome = watchForWelcome();
      fireEvent.click(finish);

      await waitFor(() => {
        expect(screen.queryByRole("button", { name: "Finish tour" }))
          .not.toBeInTheDocument();
      });
      welcome.stop();
      expect(welcome.returned()).toBe(false);
      expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
      const onboarding = studioApolloClient().readQuery({
        query: WorkTrackerOnboardingDocument,
      });
      expect(onboarding?.projects.nodes).toHaveLength(1);
      expect(onboarding?.projects.nodes[0]).toMatchObject({
        onboarding_required: false,
      });
      expect(compactWorktrackerId(onboarding!.projects.nodes[0].id)).toBe(
        compactWorktrackerId(PROJECT_ID),
      );
      expect(useClientStore.getState()).toMatchObject({
        selectedModuleId: MODULE_ID,
        selectedTaskId: STORY_ID,
      });
      expect(screen.queryByText("Your first story is ready")).not.toBeInTheDocument();

      firstRun.unmount();
      await studioApolloClient().clearStore();
      resetClientRuntime();
      mountApplication();

      expect(await screen.findByRole("treeitem", {
        name: /Keep my selected story/,
      })).toHaveAttribute("aria-selected", "true");
      await waitFor(() => expect(useClientStore.getState()).toMatchObject({
        selectedModuleId: MODULE_ID,
        selectedTaskId: STORY_ID,
      }));
      expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
      expect(screen.queryByText("Add your first module")).not.toBeInTheDocument();
      expect(boundary.providerChoice).toBe(choice);
      expectNoLaunchOperations(boundary);
    },
  );

  it.each([
    ["zero providers", "none"],
    ["selected Codex", "codex"],
  ] as const)(
    "[overhaul-371] keeps the selected Story usable while %s acknowledgement fails once and then succeeds",
    async (_label, choice) => {
      const boundary = new DurableOnboardingBoundary();
      boundary.holdNextAcknowledgement();
      installBoundary(boundary);
      const firstRun = mountApplication();
      const finish = await reachFinalCoachMark(choice);
      const welcome = watchForWelcome();

      fireEvent.click(finish);

      await waitFor(() => expect(boundary.acknowledgementAttempts).toBe(1));
      const finishing = screen.getByRole("button", { name: "Finishing…" });
      expect(finishing).toBeDisabled();
      expect(screen.getByRole("heading", {
        name: "Your first story is ready",
      })).toBeVisible();
      await expectSelectedOnboardingStory();
      expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
      expect(boundary.onboardingRequired).toBe(true);
      expect(studioApolloClient().readQuery({
        query: WorkTrackerOnboardingDocument,
      })?.projects.nodes[0]).toMatchObject({ onboarding_required: true });
      expect(boundary.providerChoice).toBe(choice);
      expectCreatedContentOnce(boundary);
      expectNoLaunchOperations(boundary);

      fireEvent.click(finishing);
      expect(boundary.acknowledgementAttempts).toBe(1);

      act(() => {
        boundary.rejectHeldAcknowledgement(new Error("Acknowledgement unavailable"));
      });

      expect(await screen.findByTestId("onboarding-step-error")).toHaveTextContent(
        "Acknowledgement unavailable",
      );
      expect(screen.getByRole("button", { name: "Finish tour" })).toBeEnabled();
      expect(useOnboardingTourStore.getState().step).toBe("handoff");
      expect(boundary.onboardingRequired).toBe(true);
      expect(studioApolloClient().readQuery({
        query: WorkTrackerOnboardingDocument,
      })?.projects.nodes[0]).toMatchObject({ onboarding_required: true });
      await expectSelectedOnboardingStory();
      expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
      expect(boundary.providerChoice).toBe(choice);
      expectCreatedContentOnce(boundary);
      expectNoLaunchOperations(boundary);

      fireEvent.click(screen.getByRole("button", { name: "Finish tour" }));

      await waitFor(() => {
        expect(boundary.acknowledgementAttempts).toBe(2);
        expect(screen.queryByRole("button", { name: "Finish tour" }))
          .not.toBeInTheDocument();
      });
      expect(boundary.acknowledgementProjectIds).toEqual([PROJECT_ID, PROJECT_ID]);
      expect(boundary.onboardingRequired).toBe(false);
      expect(boundary.providerChoice).toBe(choice);
      expect(boundary.operations.filter((operation) =>
        operation === "UpdateProviderCatalog"
      )).toHaveLength(1);
      expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
      expect(welcome.returned()).toBe(false);
      welcome.stop();
      await expectSelectedOnboardingStory();
      expectCreatedContentOnce(boundary);
      expectNoLaunchOperations(boundary);

      firstRun.unmount();
      await studioApolloClient().clearStore();
      resetClientRuntime();
      mountApplication();

      await expectSelectedOnboardingStory();
      expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
      expect(screen.queryByText("Add your first module")).not.toBeInTheDocument();
      expect(boundary.providerChoice).toBe(choice);
      expectCreatedContentOnce(boundary);
      expectNoLaunchOperations(boundary);
    },
  );
});
