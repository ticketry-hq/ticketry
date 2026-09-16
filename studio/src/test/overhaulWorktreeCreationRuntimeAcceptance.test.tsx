import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { useModalStore } from "../app/modal";
import { DialogHost } from "../app/shell/DialogHost";
import { WorktreeBlock } from "../features/agents/worktrees";
import { createDesktopRuntime } from "../runtime/desktopRuntime";
import { initializeStudioRuntime, type DirectoryTrustResult } from "../runtime";
import { useClientStore } from "../state/clientStore";

const startup = {
  serviceHealth: {
    state: "ready" as const,
    service: "backend",
    message: null,
    logPointer: null,
  },
  initialNotices: [],
};

const TASK = "60000000-0000-0000-0000-000000000001";

const absent = {
  kind: "none",
  task_id: TASK,
  top_level_task_id: TASK,
  is_shared: false,
  branch: null,
  base_branch: null,
  path: null,
  state: null,
  clean: null,
  dirty: null,
  ahead: null,
  behind: null,
  conflict: null,
  checkout_present: null,
  ephemeral: false,
  reason: null,
};

/// What Rust answers a creation with: the authoritative live status of the
/// checkout that now exists, derived entirely from the submitted identity.
const created = {
  ...absent,
  kind: "worktree",
  branch: "wt/CODIN-881-parent-story",
  base_branch: "main",
  path: "/checkouts/ticketry/CODIN-881-parent-story",
  state: "active",
  clean: true,
  dirty: false,
  ahead: 0,
  behind: 0,
  conflict: false,
  checkout_present: true,
};

interface Request {
  operationName: string;
  variables: Record<string, unknown>;
}

type Trust = (provider: string, directory: string, approval: string | null) => Promise<DirectoryTrustResult>;

async function installDesktopRuntime(
  requests: Request[],
  trust?: Trust,
  recovered: typeof created | false = false,
) {
  const graphqlExecute = vi.fn(async (requestJson: string) => {
    const request = JSON.parse(requestJson) as Request;
    requests.push(request);
    if (request.operationName === "WorktreeStatus") {
      const answered = recovered || requests.some(
        (earlier) => earlier.operationName === "WorktreeCreate",
      );
      return JSON.stringify({
        data: { worktree_status: recovered || (answered ? created : absent) },
      });
    }
    if (request.operationName === "WorktreeCreate") {
      return JSON.stringify({ data: { worktree_create: created } });
    }
    throw new Error(`Unexpected operation ${request.operationName}`);
  });
  initializeStudioRuntime(
    await createDesktopRuntime({
      invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
        if (command === "desktop_runtime_configuration") return startup;
        if (command === "desktop_prepare_directory_trust" && trust) {
          return trust(
            args?.provider as string,
            args?.directory as string,
            (args?.approval as string | null) ?? null,
          );
        }
        throw new Error(`Unexpected command ${command}`);
      }) as never,
      createGraphQlProxy: () => ({
        graphql_execute: graphqlExecute,
        graphql_subscribe: vi.fn(),
      }) as never,
    }),
  );
}

describe("worktree creation desktop runtime acceptance", () => {
  beforeEach(() => {
    useClientStore.setState({ dialogs: [] });
    useModalStore.setState({ modalStack: [] });
  });

  it("[overhaul-88] opts a task into a worktree by identity alone and renders the authoritative result", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const requests: Request[] = [];
    await installDesktopRuntime(requests);

    render(
      <WorktreeBlock
        taskId={TASK}
        parentId={null}
        moduleId="m1"
      />,
    );

    const create = await screen.findByRole("button", {
      name: "+ Create worktree",
    });
    fireEvent.click(create);

    // The mutation's own response is the authority for the window that asked:
    // the block renders the live checkout without a follow-up status read.
    expect(
      await screen.findByText("wt/CODIN-881-parent-story → main"),
    ).toBeTruthy();
    expect(screen.getByText("clean")).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "+ Create worktree" }),
      ).toBeNull(),
    );

    // Studio submits two identities and nothing else — no parent, module,
    // project, ticket sequence, or name is trusted as authority — and no
    // legacy host route is consulted.
    const create_ = requests.filter(
      (request) => request.operationName === "WorktreeCreate",
    );
    expect(create_).toHaveLength(1);
    expect(Object.keys(create_[0].variables).sort()).toEqual([
      "operationId",
      "taskId",
    ]);
    expect(create_[0].variables.taskId).toBe(TASK);
    expect(typeof create_[0].variables.operationId).toBe("string");
    expect(create_[0].variables.operationId).not.toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("[overhaul-89] reuses one operation identity for the retries of one intent", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const requests: Request[] = [];
    await installDesktopRuntime(requests);

    const first = render(
      <WorktreeBlock taskId={TASK} moduleId="m1" />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "+ Create worktree" }),
    );
    await screen.findByText("wt/CODIN-881-parent-story → main");
    first.unmount();

    render(<WorktreeBlock taskId={TASK} moduleId="m1" />);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "+ Create worktree" }),
      ).toBeNull(),
    );

    const identities = requests
      .filter((request) => request.operationName === "WorktreeCreate")
      .map((request) => request.variables.operationId);
    expect(identities).toHaveLength(1);
    // A second intent would mint its own identity; this one never re-asks,
    // because the worktree it created is already the answer.
    expect(new Set(identities).size).toBe(identities.length);
  });

  it("[overhaul-308] creates the checkout before asking to trust its canonical external directory", async () => {
    const requests: Request[] = [];
    const trust = vi.fn(async (provider: string, _directory: string, approval: string | null) => ({
      status: approval ? "prepared" as const : "approval_required" as const,
      approval: approval ? null : `${provider}-approval`,
      directory: "/canonical/external/CODIN-881-parent-story",
    }));
    await installDesktopRuntime(requests, trust);

    render(<><WorktreeBlock taskId={TASK} moduleId="m1" /><DialogHost /></>);
    fireEvent.click(await screen.findByRole("button", { name: "+ Create worktree" }));

    const dialog = await screen.findByRole("dialog", { name: "Trust worktree?" });
    expect(dialog).toHaveTextContent("/canonical/external/CODIN-881-parent-story");
    expect(dialog).toHaveTextContent("Codex, Gemini, and Claude");
    expect(screen.getByText("wt/CODIN-881-parent-story → main")).toBeTruthy();
    expect(trust.mock.calls.every(([, directory]) => directory === created.path)).toBe(true);
    expect(trust.mock.calls.every(([, , approval]) => approval === null)).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: "Trust worktree" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Trust worktree?" })).toBeNull());
    expect(trust.mock.calls.filter(([, , approval]) => approval !== null)).toHaveLength(3);
  });

  it("[overhaul-309] silently accepts trusted reuse and keeps a recovered checkout after refusal", async () => {
    const requests: Request[] = [];
    const trust = vi.fn<Trust>(async () => ({
      status: "already_trusted" as const,
      approval: null,
      directory: created.path,
    }));
    const shared = {
      ...created,
      task_id: `${TASK}-child`,
      top_level_task_id: TASK,
      is_shared: true,
    };
    await installDesktopRuntime(requests, trust, shared);

    const first = render(<><WorktreeBlock taskId={`${TASK}-child`} moduleId="m1" /><DialogHost /></>);
    expect(await screen.findByText(`Shares the worktree owned by top-level task (${TASK}).`)).toBeTruthy();
    await waitFor(() => expect(trust).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole("dialog", { name: "Trust worktree?" })).toBeNull();
    expect(requests.filter(({ operationName }) => operationName === "WorktreeCreate")).toHaveLength(0);
    first.unmount();

    trust.mockImplementation(async (provider) => ({
      status: "approval_required",
      approval: `${provider}-approval`,
      directory: created.path,
    }));
    render(
      <StrictMode>
        <WorktreeBlock taskId={`${TASK}-refused`} moduleId="m1" />
        <DialogHost />
      </StrictMode>,
    );
    const dialog = await screen.findByRole("dialog", { name: "Trust worktree?" });
    expect(trust).toHaveBeenCalledTimes(6);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(await screen.findByText("Worktree trust was not approved. Retry to continue.")).toBeTruthy();
    expect(screen.getByText(`Shares the worktree owned by top-level task (${TASK}).`)).toBeTruthy();
    expect(requests.filter(({ operationName }) => operationName === "WorktreeCreate")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Retry trust" }));
    const retry = await screen.findByRole("dialog", { name: "Trust worktree?" });
    expect(trust).toHaveBeenCalledTimes(9);
    fireEvent.click(within(retry).getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Worktree trust was not approved. Retry to continue.")).toBeTruthy();
  });

  it("[overhaul-310] retains partial trust and retries the same checkout without creating again", async () => {
    const requests: Request[] = [];
    let codexTrusted = false;
    let claudePrepares = 0;
    const trust = vi.fn(async (provider: string, _directory: string, approval: string | null) => {
      if (provider === "codex") {
        if (codexTrusted) return { status: "already_trusted" as const, approval: null, directory: created.path };
        if (approval) { codexTrusted = true; return { status: "prepared" as const, approval: null, directory: created.path }; }
      }
      if (provider === "gemini") return { status: "already_trusted" as const, approval: null, directory: created.path };
      if (provider === "claude" && approval && claudePrepares++ === 0) throw new Error("config busy");
      return {
        status: approval ? "prepared" as const : "approval_required" as const,
        approval: approval ? null : `${provider}-approval`,
        directory: created.path,
      };
    });
    await installDesktopRuntime(requests, trust);

    render(<><WorktreeBlock taskId={TASK} moduleId="m1" /><DialogHost /></>);
    fireEvent.click(await screen.findByRole("button", { name: "+ Create worktree" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Trust worktree?" })).getByRole("button", { name: "Trust worktree" }));

    expect(await screen.findByText(/Could not prepare Claude folder trust: config busy/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry trust" }));
    const retry = await screen.findByRole("dialog", { name: "Trust worktree?" });
    expect(retry).toHaveTextContent("Claude");
    expect(retry).not.toHaveTextContent("Codex and Claude");
    fireEvent.click(within(retry).getByRole("button", { name: "Trust worktree" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry trust" })).toBeNull());
    expect(screen.getByText("wt/CODIN-881-parent-story → main")).toBeTruthy();
    expect(requests.filter(({ operationName }) => operationName === "WorktreeCreate")).toHaveLength(1);
  });
});
