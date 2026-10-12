import { afterEach, describe, expect, it } from "vitest";

import { ApiError } from "../../shared/api/errors";
import { resetStudioApolloClient, studioApolloClient } from "../../shared/apollo/client";
import { installScriptedGraphQlTransport } from "../../test/scriptedGraphQlTransport";
import { projectOpenFixture } from "../../test/projectOpenFixture";
import { WorkTrackerProjectOpenDocument } from "./generated/projects.documents";
import { createProject, deleteProject, updateProject } from "./mutationTransport";
import { getProjectsSnapshot, seedProjects } from "./queries";

afterEach(async () => resetStudioApolloClient());

const projectRow = (id: string, name: string, createdAt: string) => ({
  __typename: "WorktrackerProject",
  id,
  name,
  slug: name.toUpperCase(),
  description: "",
  created_at: createdAt,
});

const projectsAnswer = (...nodes: ReturnType<typeof projectRow>[]) => ({
  projects: { __typename: "WorktrackerProjectConnection", nodes },
});

function projectOpenAnswer(name: string) {
  const { data } = projectOpenFixture(
    { id: "p1", name, slug: "ONE", description: "" },
    [],
  );
  return {
    ...data,
    provider_catalog: { ...data.provider_catalog, codex_profiles: [] },
  };
}

function cachedOpenProjectName(): string | undefined {
  return studioApolloClient().readQuery({
    query: WorkTrackerProjectOpenDocument,
    variables: { projectId: "p1" },
  })?.project.nodes[0]?.name;
}

describe("project create", () => {
  it("sends the same payload and refreshes the projects list from the server", async () => {
    const transport = installScriptedGraphQlTransport();
    const created = { __typename: "WorktrackerProject", id: "p2", name: "Two", slug: "TWO", description: "Second" };
    transport
      .answerNext("CreateWorkTrackerProject", { create_project: created })
      .answerNext("WorkTrackerProjects", {
        projects: {
          __typename: "WorktrackerProjectConnection",
          nodes: [
            projectRow("p1", "One", "2026-10-01T00:00:00Z"),
            { ...created, created_at: "2026-10-12T00:00:00Z" },
          ],
        },
      });

    await expect(createProject({ name: "Two", slug: "TWO", description: "Second" }))
      .resolves.toMatchObject({ id: "p2", name: "Two", slug: "TWO", description: "Second" });

    expect(transport.requests).toEqual([
      {
        operationName: "CreateWorkTrackerProject",
        variables: { name: "Two", slug: "TWO", description: "Second" },
      },
      { operationName: "WorkTrackerProjects", variables: {} },
    ]);
    expect(getProjectsSnapshot().map((project) => project.id)).toEqual(["p1", "p2"]);
  });

  it("surfaces a duplicate slug as the same 409 ApiError and refreshes nothing", async () => {
    const transport = installScriptedGraphQlTransport();
    transport.failNext("CreateWorkTrackerProject", "conflict", "Slug already exists");

    const failure = await createProject({ name: "Two", slug: "TWO" })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      status: 409,
      message: "Slug already exists",
      body: { code: "conflict", detail: "Slug already exists" },
    });
    expect(transport.operationNames()).toEqual(["CreateWorkTrackerProject"]);
  });
});

describe("project update", () => {
  it("sends the same payload and refreshes the projects list and that project's open query", async () => {
    const transport = installScriptedGraphQlTransport();
    seedProjects([{ id: "p1", name: "One", slug: "ONE", description: "" }]);
    studioApolloClient().writeQuery({
      query: WorkTrackerProjectOpenDocument,
      variables: { projectId: "p1" },
      data: projectOpenAnswer("One"),
    });
    transport
      .answerNext("UpdateWorkTrackerProject", {
        update_project: { __typename: "WorktrackerProject", id: "p1", name: "Renamed", slug: "ONE", description: "" },
      })
      .answerNext("WorkTrackerProjects", projectsAnswer(
        { ...projectRow("p1", "Renamed", "2026-10-01T00:00:00Z"), slug: "ONE" },
      ))
      .answerNext("WorkTrackerProjectOpen", projectOpenAnswer("Renamed"));

    await expect(updateProject("p1", { name: "Renamed" }))
      .resolves.toMatchObject({ id: "p1", name: "Renamed" });

    expect(transport.requests).toEqual([
      { operationName: "UpdateWorkTrackerProject", variables: { id: "p1", name: "Renamed" } },
      { operationName: "WorkTrackerProjects", variables: {} },
      { operationName: "WorkTrackerProjectOpen", variables: { projectId: "p1" } },
    ]);
    expect(getProjectsSnapshot()).toMatchObject([{ id: "p1", name: "Renamed" }]);
    expect(cachedOpenProjectName()).toBe("Renamed");
  });

  it("surfaces a missing project as the same 404 ApiError", async () => {
    const transport = installScriptedGraphQlTransport();
    transport.failNext("UpdateWorkTrackerProject", "not_found", "Project not found");

    const failure = await updateProject("p1", { description: "x" })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 404, message: "Project not found" });
    expect(transport.operationNames()).toEqual(["UpdateWorkTrackerProject"]);
  });
});

describe("project delete", () => {
  it("evicts the project identity and refreshes the projects list", async () => {
    const transport = installScriptedGraphQlTransport();
    seedProjects([
      { id: "p1", name: "One", slug: "ONE", description: "" },
      { id: "p2", name: "Two", slug: "TWO", description: "" },
    ]);
    transport
      .answerNext("DeleteWorkTrackerProject", { delete_project: true })
      .answerNext("WorkTrackerProjects", projectsAnswer(
        projectRow("p1", "One", "2026-10-01T00:00:00Z"),
      ));

    await expect(deleteProject("p2")).resolves.toBeUndefined();

    expect(transport.requests).toEqual([
      { operationName: "DeleteWorkTrackerProject", variables: { id: "p2" } },
      { operationName: "WorkTrackerProjects", variables: {} },
    ]);
    expect(getProjectsSnapshot().map((project) => project.id)).toEqual(["p1"]);
    expect(studioApolloClient().cache.extract()).not.toHaveProperty(["WorktrackerProject:p2"]);
  });

  it("surfaces a storage failure as the same 503 ApiError and keeps the project", async () => {
    const transport = installScriptedGraphQlTransport();
    seedProjects([{ id: "p1", name: "One", slug: "ONE", description: "" }]);
    transport.failNext("DeleteWorkTrackerProject", "storage_unavailable", "Storage unavailable");

    const failure = await deleteProject("p1").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 503, message: "Storage unavailable" });
    expect(transport.operationNames()).toEqual(["DeleteWorkTrackerProject"]);
    expect(getProjectsSnapshot().map((project) => project.id)).toEqual(["p1"]);
  });
});
