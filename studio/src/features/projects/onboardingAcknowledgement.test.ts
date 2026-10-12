import { afterEach, describe, expect, it } from "vitest";

import { ApiError } from "../../shared/api/errors";
import { resetStudioApolloClient, studioApolloClient } from "../../shared/apollo/client";
import { installScriptedGraphQlTransport } from "../../test/scriptedGraphQlTransport";
import {
  WorkTrackerOnboardingDocument,
  type WorkTrackerOnboardingQuery,
} from "./generated/projects.documents";
import { acknowledgeOnboarding } from "./mutationTransport";

afterEach(async () => resetStudioApolloClient());

const onboardingRow = (id: string, slug: string, onboardingRequired: boolean) => ({
  __typename: "WorktrackerProject",
  id,
  slug,
  name: slug,
  onboarding_required: onboardingRequired,
});

function seedOnboarding(...nodes: ReturnType<typeof onboardingRow>[]): void {
  studioApolloClient().writeQuery({
    query: WorkTrackerOnboardingDocument,
    data: {
      projects: { __typename: "WorktrackerProjectConnection", nodes },
    } as WorkTrackerOnboardingQuery,
  });
}

function cachedOnboarding() {
  return studioApolloClient().readQuery({ query: WorkTrackerOnboardingDocument })
    ?.projects.nodes.map(({ id, onboarding_required }) => ({ id, onboarding_required }));
}

describe("onboarding acknowledgement", () => {
  it("sends the same payload and converges the onboarding read from the authoritative row", async () => {
    const transport = installScriptedGraphQlTransport();
    seedOnboarding(onboardingRow("old", "OLD", false), onboardingRow("p1", "CDN", true));
    transport.answerNext("AcknowledgeWorkTrackerOnboarding", {
      acknowledge_onboarding: onboardingRow("p1", "CDN", false),
    });

    await expect(acknowledgeOnboarding("p1")).resolves.toMatchObject({
      id: "p1",
      slug: "CDN",
      onboarding_required: false,
    });

    // The acknowledgement makes only the onboarding read stale, and the
    // authoritative row converges it: no follow-up read is sent.
    expect(transport.requests).toEqual([
      { operationName: "AcknowledgeWorkTrackerOnboarding", variables: { projectId: "p1" } },
    ]);
    expect(cachedOnboarding()).toEqual([
      { id: "old", onboarding_required: false },
      { id: "p1", onboarding_required: false },
    ]);
  });

  it("adds an acknowledged project the onboarding read has not seen", async () => {
    const transport = installScriptedGraphQlTransport();
    transport.answerNext("AcknowledgeWorkTrackerOnboarding", {
      acknowledge_onboarding: onboardingRow("p9", "CDN", false),
    });

    await acknowledgeOnboarding("p9");

    expect(cachedOnboarding()).toEqual([{ id: "p9", onboarding_required: false }]);
  });

  it("surfaces a missing project as the same 404 ApiError and leaves onboarding pending", async () => {
    const transport = installScriptedGraphQlTransport();
    seedOnboarding(onboardingRow("p1", "CDN", true));
    transport.failNext("AcknowledgeWorkTrackerOnboarding", "not_found", "Project not found");

    const failure = await acknowledgeOnboarding("p1").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 404, message: "Project not found" });
    expect(cachedOnboarding()).toEqual([{ id: "p1", onboarding_required: true }]);
  });
});
