import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useProjectsQuery } from "../features/projects";
import { queryClient } from "../shared/query/queryClient";
import { createBrowserRuntime } from "../runtime/browserRuntime";
import { createDesktopRuntime } from "../runtime/desktopRuntime";
import { initializeStudioRuntime } from "../runtime";

function ProjectNames() {
  const { data = [] } = useProjectsQuery();
  return <div>{data.map((project) => project.name).join(", ")}</div>;
}

function renderProjectNames() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectNames />
    </QueryClientProvider>,
  );
}

const project = {
  id: "project-1",
  name: "Runtime Project",
  slug: "runtime-project",
  description: "",
  manual_module_order: false,
};

describe("WorkTracker read runtime acceptance", () => {
  it("[overhaul-73] renders the same project hook through browser REST and desktop GraphQL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify([project]),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    initializeStudioRuntime(createBrowserRuntime({ environment: {} }));

    const browserView = renderProjectNames();
    expect(await screen.findByText("Runtime Project")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/work-tracker/projects",
      expect.anything(),
    );

    browserView.unmount();
    queryClient.clear();
    fetchMock.mockClear();

    const graphqlExecute = vi.fn(async (requestJson: string) => {
      const request = JSON.parse(requestJson) as { operationName: string };
      expect(request.operationName).toBe("WorkTrackerProjects");
      return JSON.stringify({ data: { projects: [project] } });
    });
    const startupInvoke = vi.fn().mockResolvedValue({
      endpoints: {
        workTrackerApi: "http://127.0.0.1:8787/api/work-tracker",
        agentApi: "http://127.0.0.1:8787/api",
        statusApi: "http://127.0.0.1:8787/api",
        statusWebSocket: "ws://127.0.0.1:8787/ws/status",
        terminalWebSocket: "ws://127.0.0.1:8787/ws/terminal",
      },
      values: { workTrackerApiKey: "" },
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
});
