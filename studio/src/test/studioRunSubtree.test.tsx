import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEMP_TASK_ID } from "../features/agents/types";
import type { TaskSummary } from "../features/studio/lib/types";
import type { WorkItem } from "../shared/api/types";
import { RunSubtreeAction } from "../features/work-items/issue-detail/RunSubtreeAction";
import { useIssueStore } from "../features/work-items/issue-detail/internal/issueStore";
import { useToastStore } from "../app/stores/toastStore";
import { useSettingsStore } from "../features/settings/store";

const fetchMock = vi.fn();
const TODO = { id: "todo", name: "Todo", group: "backlog", color: null };
const STORY_TYPE = {
  id: "story",
  name: "Story",
  level: "task",
} as NonNullable<TaskSummary["issue_type"]>;
const IMPLEMENTATION_TYPE = {
  id: "implementation",
  name: "Implementation",
  level: "task",
} as NonNullable<TaskSummary["issue_type"]>;

function task({ id, ...partial }: Partial<TaskSummary> & { id: string }): TaskSummary {
  return {
    id,
    name: id,
    project_id: "project-1",
    sequence_id: 1,
    state: TODO,
    issue_type: STORY_TYPE,
    assignees: [],
    labels: [],
    description_html: null,
    description_stripped: null,
    description: null,
    parent_id: "module-1",
    sub_issues_count: 0,
    ...partial,
  };
}

function renderAction(overrides: Partial<TaskSummary> = {}) {
  const story = task({
    id: "story",
    name: "Runnable Story",
    sub_issues_count: 1,
    ...overrides,
  });
  const leaf = task({ id: "leaf", name: "Leaf Story" });
  const implementation = task({
    id: "implementation",
    name: "Implementation child",
    parent_id: story.id,
    issue_type: IMPLEMENTATION_TYPE,
  });
  const scratch = task({
    id: TEMP_TASK_ID,
    name: "Local scratch workspace",
    issue_type: STORY_TYPE,
  });

  return {
    story,
    leaf,
    implementation,
    scratch,
    render: (candidate: TaskSummary) =>
      render(<RunSubtreeAction task={candidate} moduleId="module-1" />),
  };
}

function response(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Studio Run subtree action", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    useToastStore.setState({ toasts: [] });
    useSettingsStore.setState({
      projectId: "project-1",
      subtreeRunCapabilities: { story: ["todo"] },
      capabilitiesLoaded: true,
      settingsLoaded: true,
      loading: false,
    });
    useIssueStore.setState({
      open: null,
      children: [],
      loading: false,
      notFound: false,
      error: null,
      loadError: null,
      saving: {},
    });
  });

  it("requires a configured pair and every existing structural guard", () => {
    const { story, leaf, implementation, scratch, render: renderCandidate } = renderAction();

    const eligible = renderCandidate(story);
    expect(screen.getByRole("button", { name: "Run subtree" })).toBeEnabled();
    eligible.unmount();

    for (const candidate of [leaf, implementation, scratch]) {
      const view = renderCandidate(candidate);
      expect(screen.queryByRole("button", { name: "Run subtree" })).toBeNull();
      view.unmount();
    }

    useSettingsStore.setState({ subtreeRunCapabilities: {} });
    const disabled = renderCandidate(story);
    expect(screen.queryByRole("button", { name: "Run subtree" })).toBeNull();
    disabled.unmount();
  });

  it("flips immediately from an optimistic state change without refetching", () => {
    useSettingsStore.setState({
      subtreeRunCapabilities: { story: ["review"] },
    });
    const { story } = renderAction();
    const view = render(
      <RunSubtreeAction task={story} moduleId="module-1" />,
    );
    expect(screen.queryByRole("button", { name: "Run subtree" })).toBeNull();

    view.rerender(
      <RunSubtreeAction
        task={{
          ...story,
          state: { id: "review" },
        }}
        moduleId="module-1"
      />,
    );

    expect(screen.getByRole("button", { name: "Run subtree" })).toBeEnabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts one empty request, disables while pending, and acknowledges acceptance", async () => {
    let resolveRequest!: (value: Response) => void;
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => { resolveRequest = resolve; }),
    );
    const { story, render: renderCandidate } = renderAction();
    renderCandidate(story);
    const action = screen.getByRole("button", { name: "Run subtree" });

    fireEvent.click(action);
    fireEvent.click(action);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(action).toBeDisabled();
    expect(action).toHaveAttribute("aria-busy", "true");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/work-items/story/execute-graph");
    expect(init).toMatchObject({ method: "POST", body: "{}" });
    expect(JSON.parse(String(init.body))).toEqual({});

    resolveRequest(response({ root_id: story.id, nodes: [] }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts).toContainEqual(
        expect.objectContaining({ kind: "success", message: "Subtree run started." }),
      ),
    );
  });

  it("surfaces the backend failure message through the error toast", async () => {
    fetchMock.mockResolvedValue(response({ message: "graph_empty" }, 422));
    const { story, render: renderCandidate } = renderAction();
    renderCandidate(story);

    fireEvent.click(screen.getByRole("button", { name: "Run subtree" }));

    await waitFor(() =>
      expect(useToastStore.getState().toasts).toContainEqual(
        expect.objectContaining({
          kind: "error",
          message: "Subtree execution could not be started: 422: graph_empty",
        }),
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("explains a stale capability refusal and reloads the map and open item", async () => {
    const { story } = renderAction();
    const openTask: WorkItem = {
      ...story,
      key: "CODIN-1",
      created_at: "2026-07-25T00:00:00Z",
      updated_at: "2026-07-25T00:00:00Z",
      blocked_by_ids: [],
      blocks_ids: [],
    };
    useIssueStore.setState({
      open: { task: openTask, attachments: [] },
    });
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/work-items/story/execute-graph" && init?.method === "POST") {
        return Promise.resolve(response({ error: "subtree_run_not_enabled" }, 422));
      }
      if (url.endsWith("/projects/project-1/subtree-run-capabilities")) {
        return Promise.resolve(response({}, 200));
      }
      if (url.endsWith("/work-items/story")) {
        return Promise.resolve(
          response({
            task: { ...openTask, state: { ...TODO, id: "review", name: "Review" } },
            attachments: [],
          }, 200),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    function OpenIssueAction() {
      const open = useIssueStore((state) => state.open);
      return open
        ? <RunSubtreeAction task={open.task} moduleId="module-1" />
        : null;
    }
    render(<OpenIssueAction />);

    fireEvent.click(screen.getByRole("button", { name: "Run subtree" }));

    await waitFor(() =>
      expect(useToastStore.getState().toasts).toContainEqual(
        expect.objectContaining({
          kind: "error",
          message: "Run subtree is no longer available while this item is in Review.",
        }),
      ),
    );
    expect(screen.queryByRole("button", { name: "Run subtree" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/projects\/project-1\/subtree-run-capabilities$/),
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/work-items\/story$/),
      expect.anything(),
    );
  });
});
