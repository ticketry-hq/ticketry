import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useProjectsQuery } from "../features/projects";
import { useModuleOpen } from "../features/work-items";
import { createBrowserRuntime } from "../runtime/browserRuntime";
import { createDesktopRuntime } from "../runtime/desktopRuntime";
import { initializeStudioRuntime } from "../runtime";

function ProjectNames() {
  const { data = [] } = useProjectsQuery();
  return <div>{data.map((project) => project.name).join(", ")}</div>;
}

function renderProjectNames() {
  return render(
    <ProjectNames />,
  );
}

function ModuleTicketNames({ moduleId }: { moduleId: string }) {
  const { items, loading } = useModuleOpen(moduleId);
  return <div>{loading ? "Loading" : items.map((item) => item.name).join(", ")}</div>;
}

const project = {
  id: "project-1",
  name: "Runtime Project",
  slug: "runtime-project",
  description: "",
  manual_module_order: false,
};

describe("WorkTracker read runtime acceptance", () => {
  it("[overhaul-73] renders the same project hook through browser and desktop GraphQL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: { projects: { nodes: [{
        ...project,
        created_at: "2026-08-12T00:00:00",
      }] } } }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    initializeStudioRuntime(createBrowserRuntime({ environment: {} }));

    const browserView = renderProjectNames();
    expect(await screen.findByText("Runtime Project")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith("/graphql", expect.objectContaining({
      method: "POST",
    }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      operationName: "WorkTrackerProjects",
    });

    browserView.unmount();
    fetchMock.mockClear();

    const graphqlExecute = vi.fn(async (requestJson: string) => {
      const request = JSON.parse(requestJson) as { operationName: string; query: string };
      expect(request.operationName).toBe("WorkTrackerProjects");
      expect(request.query).toContain("worktrackerProject");
      return JSON.stringify({
        data: {
          projects: {
            nodes: [{
              ...project,
              id: "10000000000000000000000000000000",
              created_at: "2026-08-12T00:00:00",
            }],
          },
        },
      });
    });
    const startupInvoke = vi.fn().mockResolvedValue({
      serviceHealth: {
        state: "ready",
        service: "backend",
        message: null,
        logPointer: null,
      },
      initialNotices: [],
    });
    initializeStudioRuntime(await createDesktopRuntime({
      invoke: startupInvoke,
      createGraphQlProxy: () => ({
        graphql_execute: graphqlExecute,
        graphql_subscribe: vi.fn(),
        graphql_unsubscribe: vi.fn(),
      }),
    }));

    renderProjectNames();
    expect(await screen.findByText("Runtime Project")).toBeVisible();
    expect(graphqlExecute).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("[overhaul-164] renders module tickets that contain blocker edges", async () => {
    const graphqlExecute = vi.fn(async (requestJson: string) => {
      const request = JSON.parse(requestJson) as { operationName: string; query: string };
      expect(request.operationName).toBe("WorkTrackerModuleOpen");
      expect(request.query).toMatch(/blockedByEdges[\s\S]*nodes\s*\{\s*id/);
      return JSON.stringify({
        data: {
          module: { __typename: "WorktrackerIssueConnection", nodes: [] },
          work_items: {
            __typename: "WorktrackerIssueConnection",
            nodes: [{
              __typename: "WorktrackerIssue",
              id: "20000000000000000000000000000000",
              name: "Blocked ticket stays visible",
              project_id: "10000000000000000000000000000000",
              sequence_id: 2,
              state_id: null,
              description: "",
              parent_id: "30000000000000000000000000000000",
              module_id: "30000000000000000000000000000000",
              is_archived: false,
              created_at: "2026-08-27T00:00:00Z",
              updated_at: "2026-08-27T00:00:00Z",
              rank: "1",
              issue_type_id: "40000000000000000000000000000000",
              project: {
                __typename: "WorktrackerProject",
                id: "10000000000000000000000000000000",
                slug: "TEST",
              },
              state_record: null,
              issue_type_record: {
                __typename: "WorktrackerIssuetype",
                id: "40000000000000000000000000000000",
                name: "Story",
                level: "task",
                color: "#000000",
                sort_order: 1,
              },
              children: { __typename: "WorktrackerIssueConnection", nodes: [] },
              blocked_by_edges: {
                __typename: "WorktrackerIssueBlockedByConnection",
                nodes: [{
                  __typename: "WorktrackerIssueBlockedBy",
                  id: 7,
                  to_issue_id: "50000000000000000000000000000000",
                }],
              },
              blocks_edges: {
                __typename: "WorktrackerIssueBlockedByConnection",
                nodes: [],
              },
            }],
          },
        },
      });
    });
    initializeStudioRuntime(await createDesktopRuntime({
      invoke: vi.fn().mockResolvedValue({
        serviceHealth: {
          state: "ready",
          service: "backend",
          message: null,
          logPointer: null,
        },
        initialNotices: [],
      }),
      createGraphQlProxy: () => ({
        graphql_execute: graphqlExecute,
        graphql_subscribe: vi.fn(),
        graphql_unsubscribe: vi.fn(),
      }),
    }));

    render(<ModuleTicketNames moduleId="30000000-0000-0000-0000-000000000000" />);

    expect(await screen.findByText("Blocked ticket stays visible")).toBeVisible();
  });
});
