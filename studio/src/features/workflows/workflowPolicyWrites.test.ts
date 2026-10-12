import { afterEach, describe, expect, it } from "vitest";

import { ApiError } from "../../shared/api/errors";
import type { LaunchBindingInput } from "../../shared/api/types";
import { resetStudioApolloClient, studioApolloClient } from "../../shared/apollo/client";
import { installScriptedGraphQlTransport } from "../../test/scriptedGraphQlTransport";
import {
  workflowCatalogAnswer,
  workflowIssueTypeRow,
  workflowStateRow,
} from "../../test/workflowCatalogFixture";
import { WorkTrackerProjectOpenDocument } from "../projects";
import {
  addIssueTypeWorkflowTransition,
  removeIssueTypeWorkflowState,
  removeIssueTypeWorkflowTransition,
  setIssueTypeWorkflowAutoStart,
  setIssueTypeWorkflowStartState,
  setIssueTypeWorkflowSubtreeRun,
  updateIssueTypeWorkflowTransition,
  upsertIssueTypeWorkflowLaunchBinding,
} from "./mutationTransport";
import { getProjectWorkflowSettingsSnapshot } from "./queries";

afterEach(async () => resetStudioApolloClient());

const todo = workflowStateRow("s1", "Todo", 0);
const review = workflowStateRow("s2", "Review", 1, "started");
const story = workflowIssueTypeRow("t1", "Story", 0, 3);

/** The catalog with one Codex model and one reasoning level to resolve against. */
function catalogAnswer(issueTypes = [story]) {
  const answer = workflowCatalogAnswer([todo, review], issueTypes);
  const codex = {
    __typename: "WorktrackerProvider",
    id: "provider-codex",
    slug: "codex",
    activated: true,
    supports_unattended: true,
  };
  return {
    ...answer,
    provider_catalog: {
      ...answer.provider_catalog,
      configurable_providers: [codex],
      providers: [codex],
      agent_models: [{
        __typename: "WorktrackerAgentmodel",
        id: "model-luna",
        provider: "provider-codex",
        name: "gpt-5.6-luna",
        reasoning_levels: { __typename: "WorktrackerAgentmodelreasoninglevelConnection", nodes: [] },
      }],
      reasoning_levels: [
        { __typename: "WorktrackerReasoninglevel", id: "reasoning-medium", name: "medium" },
      ],
    },
  };
}

function seedCatalog() {
  studioApolloClient().writeQuery({
    query: WorkTrackerProjectOpenDocument,
    variables: { projectId: "p1" },
    data: catalogAnswer(),
  });
}

const catalogRefresh = { operationName: "WorkTrackerProjectOpen", variables: { projectId: "p1" } };

describe("per-type workflow writes", () => {
  it("sets the start state at the caller's revision and refreshes the workflow catalog", async () => {
    const transport = installScriptedGraphQlTransport();
    seedCatalog();
    transport
      .answerNext("SetWorkTrackerStartState", {
        update_issue_type: { __typename: "WorktrackerIssuetype", id: "t1", workflow_revision: 4 },
      })
      .answerNext("WorkTrackerProjectOpen", catalogAnswer(
        [{ ...story, start_state: "s2", workflow_revision: 4 }],
      ));

    await setIssueTypeWorkflowStartState("p1", "t1", "s2", 3);

    expect(transport.requests).toEqual([
      {
        operationName: "SetWorkTrackerStartState",
        variables: { id: "t1", startStateId: "s2", workflowRevision: 3 },
      },
      catalogRefresh,
    ]);
    expect(getProjectWorkflowSettingsSnapshot("p1").t1).toMatchObject({
      start_state_id: "s2",
      workflow_revision: 4,
    });
  });

  it.each([
    {
      write: () => addIssueTypeWorkflowTransition("p1", "t1", {
        from_state_id: "s1", to_state_id: "s2", agent_allowed: true, handoff: false, workflow_revision: 3,
      }),
      operationName: "CreateWorkTrackerTransition",
      answer: { create_issue_type_transition: { __typename: "WorktrackerIssuetypetransition", id: 7 } },
      variables: {
        issueTypeId: "t1", fromStateId: "s1", toStateId: "s2",
        agentAllowed: true, handoff: false, workflowRevision: 3,
      },
    },
    {
      write: () => updateIssueTypeWorkflowTransition("p1", "t1", "s1", "s2", false, true, 3),
      operationName: "UpdateWorkTrackerTransition",
      answer: { update_issue_type_transition: { __typename: "WorktrackerIssuetypetransition", id: 7 } },
      variables: {
        issueTypeId: "t1", fromStateId: "s1", toStateId: "s2",
        agentAllowed: false, handoff: true, workflowRevision: 3,
      },
    },
    {
      write: () => removeIssueTypeWorkflowTransition("p1", "t1", "s1", "s2", 3),
      operationName: "DeleteWorkTrackerTransition",
      answer: { delete_issue_type_transition: true },
      variables: { issueTypeId: "t1", fromStateId: "s1", toStateId: "s2", workflowRevision: 3 },
    },
    {
      write: () => removeIssueTypeWorkflowState("p1", "t1", "s2", 3),
      operationName: "RemoveWorkTrackerWorkflowState",
      answer: { remove_state_from_issue_type_workflow: true },
      variables: { issueTypeId: "t1", stateId: "s2", workflowRevision: 3 },
    },
    {
      write: () => setIssueTypeWorkflowAutoStart("p1", "t1", "s2", true, 3),
      operationName: "SetWorkTrackerAutoStart",
      answer: { upsert_issue_type_launch_binding: { __typename: "WorktrackerLaunchbinding", id: 1 } },
      variables: { issueTypeId: "t1", stateId: "s2", workflowRevision: 3, autoStart: true },
    },
    {
      write: () => setIssueTypeWorkflowSubtreeRun("p1", "t1", "s2", false, 3),
      operationName: "SetWorkTrackerSubtreeRun",
      answer: { upsert_issue_type_launch_binding: { __typename: "WorktrackerLaunchbinding", id: 1 } },
      variables: { issueTypeId: "t1", stateId: "s2", workflowRevision: 3, enabled: false },
    },
  ])("$operationName sends the same payload and refreshes the workflow catalog", async ({
    write, operationName, answer, variables,
  }) => {
    const transport = installScriptedGraphQlTransport();
    seedCatalog();
    transport
      .answerNext(operationName, answer)
      .answerNext("WorkTrackerProjectOpen", catalogAnswer());

    await write();

    expect(transport.requests).toEqual([{ operationName, variables }, catalogRefresh]);
  });

  it("rejects a stale revision as a 409 ApiError and refreshes nothing", async () => {
    const transport = installScriptedGraphQlTransport();
    seedCatalog();
    transport.failNext("SetWorkTrackerAutoStart", "stale_revision", "Workflow revision is stale");

    const failure = await setIssueTypeWorkflowAutoStart("p1", "t1", "s2", true, 3)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      status: 409,
      body: { code: "stale_revision", detail: "Workflow revision is stale" },
    });
    expect(transport.operationNames()).toEqual(["SetWorkTrackerAutoStart"]);
  });
});

describe("launch-binding upsert", () => {
  const upsert = (binding: LaunchBindingInput) =>
    upsertIssueTypeWorkflowLaunchBinding("p1", "t1", "s2", binding, 3, true, false);
  const upsertAnswer = {
    upsert_issue_type_launch_binding: {
      __typename: "WorktrackerLaunchbinding", id: 1, stage_skills: [], profile: null,
    },
  };

  it("resolves catalog names to identities and omits every field the caller left out", async () => {
    const transport = installScriptedGraphQlTransport();
    seedCatalog();
    transport
      .answerNext("UpsertWorkTrackerLaunchBinding", upsertAnswer)
      .answerNext("WorkTrackerProjectOpen", catalogAnswer());

    await upsert({ agent: "codex", model: "gpt-5.6-luna", reasoning: "medium" });

    expect(transport.requests).toEqual([
      {
        operationName: "UpsertWorkTrackerLaunchBinding",
        variables: {
          issueTypeId: "t1", stateId: "s2", workflowRevision: 3,
          modelId: "model-luna", reasoningId: "reasoning-medium",
          autoStart: true, subtreeRunEnabled: false,
        },
      },
      catalogRefresh,
    ]);
  });

  it("sends cleared prompt, skills and profile as cleared", async () => {
    const transport = installScriptedGraphQlTransport();
    seedCatalog();
    transport
      .answerNext("UpsertWorkTrackerLaunchBinding", upsertAnswer)
      .answerNext("WorkTrackerProjectOpen", catalogAnswer());

    await upsert({ agent: "codex", prompt: "", required_skills: [], stage_skills: [], profile: null });

    expect(transport.requests[0]).toEqual({
      operationName: "UpsertWorkTrackerLaunchBinding",
      variables: {
        issueTypeId: "t1", stateId: "s2", workflowRevision: 3,
        prompt: "", requiredSkills: [], stageSkills: [], profile: null,
        modelId: null, reasoningId: null,
        autoStart: true, subtreeRunEnabled: false,
      },
    });
  });

  it("reads the workflow catalog from the network when none is cached", async () => {
    const transport = installScriptedGraphQlTransport();
    transport
      .answerNext("WorkTrackerProjectOpen", catalogAnswer())
      .answerNext("UpsertWorkTrackerLaunchBinding", upsertAnswer)
      .answerNext("WorkTrackerProjectOpen", catalogAnswer());

    await upsert({ agent: "codex", model: "gpt-5.6-luna" });

    expect(transport.operationNames()).toEqual([
      "WorkTrackerProjectOpen",
      "UpsertWorkTrackerLaunchBinding",
      "WorkTrackerProjectOpen",
    ]);
    expect(transport.requests[1].variables).toMatchObject({ modelId: "model-luna", reasoningId: null });
  });

  it.each([
    [{ agent: "claude" }, "Agent/provider 'claude' is not in the catalog."],
    [{ agent: "codex", model: "gpt-0" }, "Model 'gpt-0' is not in the catalog for agent/provider 'codex'."],
    [{ model: "gpt-0" }, "Model 'gpt-0' is not in the catalog for agent/provider ''."],
    [{ agent: "codex", reasoning: "extreme" }, "Reasoning 'extreme' is not in the catalog."],
  ] as [LaunchBindingInput, string][])("rejects unknown catalog entry %o before sending", async (binding, message) => {
    const transport = installScriptedGraphQlTransport();
    seedCatalog();

    await expect(upsert(binding)).rejects.toThrow(message);

    expect(transport.requests).toEqual([]);
  });
});
