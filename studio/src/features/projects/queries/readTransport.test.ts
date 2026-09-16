import { describe, expect, it } from "vitest";

import type { Module, Project } from "../../../shared/api/types";
import { projectOpenFixture } from "../../../test/projectOpenFixture";
import { modulesFromProjectOpen } from "./readTransport";

const PROJECT_ID = "project-1";

function module(id: string, sequenceId: number): Module {
  return {
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
