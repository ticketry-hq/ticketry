import { describe, expect, it, vi } from "vitest";

import type { Module, Project } from "../types";
import { projectOpenFixture } from "../../../test/projectOpenFixture";
import { modulesFromProjectOpen, readProjects, readProjectOpen, readOnboardingProjects } from "./readTransport";
import { studioApolloClient } from "../../../shared/apollo/client";

const PROJECT_ID = "project-1";

function module(id: string, sequenceId: number): Module {
  return {
    rank: "",
    project: null,
    id,
    name: id,
    project_id: PROJECT_ID,
    key: `PRJ-${sequenceId}`,
    sequence_id: sequenceId,
    is_archived: false,
    issue_type: "module-type",
  };
}

describe("project-open module ordering", () => {
  it("ignores presentations that do not belong to an active module in the project", () => {
    const project: Project = {
      created_at: "2026-01-01T00:00:00Z",
      id: PROJECT_ID,
      name: "Project",
      slug: "PRJ",
      description: "",
    };
    const result = projectOpenFixture(project, [
      module("module-z", 1),
      module("module-a", 2),
    ]).data;
    result.module_presentations.nodes.push({
      module_id: "other-project-module",
      rank: "00000000",
      tab_hidden: false,
      module: {
        id: "other-project-module",
        project_id: "other-project",
      },
    });

    expect(modulesFromProjectOpen(result).map(({ id }) => id)).toEqual([
      "module-z",
      "module-a",
    ]);
  });

  it("keeps unranked migrated modules before ranked modules in a manual order", () => {
    const project: Project = {
      created_at: "2026-01-01T00:00:00Z",
      id: PROJECT_ID,
      name: "Project",
      slug: "PRJ",
      description: "",
    };
    const result = projectOpenFixture(project, [
      module("module-z", 1),
      module("module-a", 2),
      module("module-b", 3),
    ]).data;
    result.module_presentations.nodes.push(
      {
        module_id: "module-a",
        rank: "00000000",
        tab_hidden: false,
        module: { id: "module-a", project_id: PROJECT_ID },
      },
      {
        module_id: "module-b",
        rank: "zzzzzzzz",
        tab_hidden: false,
        module: { id: "module-b", project_id: PROJECT_ID },
      },
    );

    expect(modulesFromProjectOpen(result).map(({ id }) => id)).toEqual([
      "module-z",
      "module-a",
      "module-b",
    ]);
  });
});


describe("project read Apollo I/O", () => {
  it("converts selected project and module fields while preserving raw Apollo rows", async () => {
    const projectId = "10000000000000000000000000000000";
    const moduleId = "20000000000000000000000000000000";
    const row = { id: projectId, name: "Project", slug: "PRJ", description: "", created_at: "2026-01-01T00:00:00" };
    const opened = projectOpenFixture(row, []).data;
    opened.project.nodes = [row];
    opened.modules.nodes = [{ id: moduleId, project_id: projectId, name: "Module", sequence_id: 7,
      is_archived: false, issue_type: "30000000000000000000000000000000", rank: "module-rank",
      project: { id: projectId, slug: "PRJ" } }];
    const query = vi.spyOn(studioApolloClient(), "query")
      .mockResolvedValueOnce({ data: { projects: { nodes: [row] } } })
      .mockResolvedValueOnce({ data: opened })
      .mockResolvedValueOnce({ data: { projects: { nodes: [{ id: projectId, name: "Project", slug: "PRJ", onboarding_required: true }] } } });


    expect(await readProjects()).toEqual([{ ...row, id: "10000000-0000-0000-0000-000000000000", created_at: "2026-01-01T00:00:00Z" }]);
    const result = await readProjectOpen("10000000-0000-0000-0000-000000000000");
    expect(query.mock.calls[1][0].variables).toEqual({ projectId });
    expect(result.data).toBe(opened);
    expect(result.modules[0]).toEqual({ ...opened.modules.nodes[0],
      id: "20000000-0000-0000-0000-000000000000", project_id: "10000000-0000-0000-0000-000000000000",
      issue_type: "30000000-0000-0000-0000-000000000000", key: "PRJ-7",
      project: { id: "10000000-0000-0000-0000-000000000000", slug: "PRJ" } });
    expect(await readOnboardingProjects()).toEqual([{ id: "10000000-0000-0000-0000-000000000000", name: "Project", slug: "PRJ", onboarding_required: true }]);
    expect(row.id).toBe(projectId);
    expect(row.created_at).toBe("2026-01-01T00:00:00");
  });
});
