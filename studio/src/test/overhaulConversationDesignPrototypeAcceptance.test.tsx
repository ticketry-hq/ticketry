import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { TasksPane } from "../app/shell/ticket-workspace/tasks/TasksPane";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { useStudioStore } from "../features/projects/store";
import { StudioApolloProvider } from "../shared/apollo/StudioApolloProvider";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { useClientStore } from "../state/clientStore";
import { installDesktopGraphQlRuntime } from "./desktopGraphQlRuntime";
import { seedModuleOpenFixture } from "./projectOpenFixture";

const VARIANTS = ["list", "inbox", "timeline"] as const;
const VARIANT_NAMES = {
  list: "Chat list",
  inbox: "Attention inbox",
  timeline: "Status timeline",
} as const;

const conversations = Array.from({ length: 12 }, (_, index) => ({
  __typename: "InstantRunTicket" as const,
  agent_run_id: `conversation-${index + 1}`,
  title: `Prototype chat ${String(index + 1).padStart(2, "0")}`,
  started_at: `2026-09-01T${String(index).padStart(2, "0")}:00:00Z`,
}));

function openPrototype(variant: (typeof VARIANTS)[number]) {
  window.history.replaceState({}, "", `/?conversation-design=${variant}`);
  render(
    <StudioApolloProvider>
      <TasksPane />
    </StudioApolloProvider>,
  );
}

describe("overhaul acceptance - Conversations design prototype", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    installDesktopGraphQlRuntime(async (document) => {
      if (documentOperationName(document) === "InstantRunTickets") {
        return { tickets: conversations } as never;
      }
      return {} as never;
    });
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useClientStore.setState({
      selectedModuleId: "module-1",
      selectedTaskId: null,
      storySearchQuery: "",
      focusedPane: "tasks",
      sidebarVisible: true,
    });
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: {
        "conversation-1": {
          agent_run_id: "conversation-1",
          project_id: "project-1",
          task_id: null,
          module_id: "module-1",
          agent: "codex",
          scope: "instant",
          state: "working",
          updated_at: "2026-09-01T12:00:00Z",
        },
        "conversation-2": {
          agent_run_id: "conversation-2",
          project_id: "project-1",
          task_id: null,
          module_id: "module-1",
          agent: "codex",
          scope: "instant",
          state: "needs_input",
          updated_at: "2026-09-01T11:00:00Z",
        },
        "conversation-3": {
          agent_run_id: "conversation-3",
          project_id: "project-1",
          task_id: null,
          module_id: "module-1",
          agent: "codex",
          scope: "instant",
          state: "quiet",
          updated_at: "2026-09-01T10:00:00Z",
        },
        "conversation-4": {
          agent_run_id: "conversation-4",
          project_id: "project-1",
          task_id: null,
          module_id: "module-1",
          agent: "codex",
          scope: "plan",
          state: "exited",
          updated_at: "2026-09-01T09:00:00Z",
        },
        "conversation-5": {
          agent_run_id: "conversation-5",
          project_id: "project-1",
          task_id: "story-1",
          module_id: "module-1",
          agent: "codex",
          scope: "task",
          state: "lost",
          updated_at: "2026-09-01T08:00:00Z",
        },
      },
      automationAttempts: {},
      automationByTask: {},
    });
    seedModuleOpenFixture("module-1", []);
  });

  it.each(VARIANTS)(
    "selects and switches the named %s design from the query parameter",
    async (variant) => {
      openPrototype(variant);

      const switcher = await screen.findByLabelText("Conversation design options");
      expect(within(switcher).getByText(new RegExp(VARIANT_NAMES[variant], "i")))
        .toBeVisible();

      const nextVariant = VARIANTS[
        (VARIANTS.indexOf(variant) + 1) % VARIANTS.length
      ];
      fireEvent.click(screen.getByRole("button", {
        name: "Next conversation design",
      }));
      expect(await within(switcher).findByText(new RegExp(VARIANT_NAMES[nextVariant], "i")))
        .toBeVisible();
      expect(new URLSearchParams(window.location.search).get("conversation-design"))
        .toBe(nextVariant);
    },
  );

  it.each(VARIANTS)("[overhaul-242] caps the %s design at ten chats", async (variant) => {
    openPrototype(variant);

    expect(await screen.findByRole("button", { name: /New chat/i })).toBeVisible();
    expect(await screen.findAllByTestId("prototype-chat")).toHaveLength(10);

    fireEvent.click(screen.getByRole("button", { name: /^See all/i }));
    await waitFor(() =>
      expect(screen.getAllByTestId("prototype-chat").length).toBeGreaterThan(10),
    );

    fireEvent.click(screen.getByRole("button", { name: /^Hide$/i }));
    await waitFor(() =>
      expect(screen.getAllByTestId("prototype-chat")).toHaveLength(10),
    );
    expect(screen.getByRole("button", { name: /^See all/i })).toBeVisible();
  });

  it("shows lifecycle and run-kind labels without a relaunch action", async () => {
    openPrototype("list");

    await screen.findAllByTestId("prototype-chat");
    for (const label of [
      "Active",
      "Needs input",
      "Resumable",
      "Terminated",
      "Killed",
      "Plan",
      "Instant",
      "Task-bound",
    ]) {
      expect(screen.getAllByText(new RegExp(`^${label}$`, "i")).length)
        .toBeGreaterThan(0);
    }
    expect(screen.queryByRole("button", { name: /relaunch/i }))
      .not.toBeInTheDocument();
  });
});
