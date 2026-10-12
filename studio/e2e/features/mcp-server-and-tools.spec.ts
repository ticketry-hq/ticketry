import { lstatSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { featureSuite } from "./featureSuite";
import { createProject, createWorkItem, getWorkflowCatalog, getWorkItem, getWorkItems, graphql, openWorkItem } from "../support";
import { TaskResumableTerminalSessionsDocument, TaskTerminalSessionsDocument } from "../../src/features/agents/terminal/generated/terminalSessions.documents";
import { CreateSprintDocument } from "../../src/features/sprints/generated/sprints.documents";
import { CreateSprintGoalDocument } from "../../src/features/sprints/goals/generated/goals.documents";
import { withProviderMcp } from "../fixtures/provider-mcp.mjs";
import { agentStatus, waitForAgentExit } from "../agent-lifecycle-support";
import { releaseConversation } from "../conversation-support";
import { fixtureLaunchEvidence } from "../agent-launch-support";
import {
  compactId,
  writeFixtureControl,
  bridgeInitialize,
  e2eDataDirectory,
  fixtureBridgeCalls,
  launchHook,
  runBridge,
  launchFixtureRun,
  lifecycleChip,
  mcpHandshake,
  processAlive,
  rowBadge,
  runHolding,
} from "../agent-services-support";
import {
  attachmentContents,
  callMcpTool,
  cleanupWorkItemsFixture,
  editDescription,
  fixture,
  names,
  openFeatureModule as openModule,
  seedProject,
  selectState,
} from "../work-items-migration-support";

featureSuite("mcp-server-and-tools", { isolation: "case" }, () => {
  test.beforeAll(async ({ request }) => { await seedProject(request); });
  test.afterAll(cleanupWorkItemsFixture);

  test("answers a transport ping on the isolated socket without writing work", { tag: "@case-mcp-socket-ping" }, async ({ page, request }) => {
    const before = await getWorkItems(request, fixture.project.id);
    expect(await callMcpTool<{ status?: string; server?: string }>("mcp_ping", {}))
      .toEqual({ status: "ok", server: "ticketry" });
    await openModule(page, names.module);
    await page.reload();
    await expect(page.getByRole("treeitem", { name: new RegExp(names.parent) })).toBeVisible();
    expect(await getWorkItems(request, fixture.project.id)).toEqual(before);
  });

  test("renders an attachment created through the Rust MCP", { tag: "@case-mcp-attachment-renders" }, async ({
    page,
  }) => {
    const result = await callMcpTool<{ success?: boolean }>(
      "attach_file",
      {
        project_id: fixture.project.id,
        task_id: fixture.parent.id,
        file_path: fixture.attachmentPath,
      },
    );
    expect(result.success).toBe(true);

    await openModule(page, names.module);
    await openWorkItem(page, names.parent);
    const attachments = page.getByTestId("attachments");
    await expect(attachments).toContainText("Attachments1");
    const attachment = attachments.getByRole("link", {
      name: /e2e-implementation-notes\.md/,
    });
    await expect(attachment).toBeVisible();
    await expect(attachment).toContainText(
      `${Buffer.byteLength(attachmentContents)} B`,
    );
    await expect(attachment).toHaveAttribute(
      "href",
      /worktracker\/attachments\/e2e-implementation-notes\.md$/,
    );

    await page.reload();
    await expect(page.getByTestId("attachments").getByRole("link", {
      name: /e2e-implementation-notes\.md/,
    })).toContainText(`${Buffer.byteLength(attachmentContents)} B`);
  });

  test("rejects a missing MCP attachment without creating a phantom row", { tag: "@case-mcp-attachment-missing" }, async ({
    page,
  }) => {
    // Case isolation: this case creates the one real attachment it guards.
    expect(await callMcpTool<{ success?: boolean }>("attach_file", {
      project_id: fixture.project.id,
      task_id: fixture.parent.id,
      file_path: fixture.attachmentPath,
    })).toMatchObject({ success: true });
    const result = await callMcpTool<{
      success?: boolean;
      message?: string;
      data?: unknown;
    }>("attach_file", {
      project_id: fixture.project.id,
      task_id: fixture.parent.id,
      file_path: join(fixture.folder, "missing-e2e-evidence.txt"),
    });
    expect(result).toEqual({
      success: false,
      message: "File not found",
      data: null,
    });

    await openModule(page, names.module);
    await openWorkItem(page, names.parent);
    await expect(page.getByTestId("attachments").getByTestId("attachment-row"))
      .toHaveCount(1);
    await page.reload();
    await expect(page.getByTestId("attachments").getByTestId("attachment-row"))
      .toHaveCount(1);
  });

  test("converges an ordinary MCP task edit and workflow move into the open UI", { tag: "@case-mcp-task-edit-and-move" }, async ({
    page,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.moving);
    const changedName = "MCP-updated moving task";
    const changedDescription = "Description replaced through the Rust MCP.";

    const updated = await callMcpTool<{
      ok?: boolean;
      updated_fields?: string[];
    }>("update_task", {
      id_or_key: fixture.moving.id,
      name: changedName,
      description: changedDescription,
    });
    expect(updated).toMatchObject({
      ok: true,
      updated_fields: ["name", "description"],
    });
    await expect(page.getByTestId("issue-name")).toContainText(changedName);
    await expect(page.getByTestId("issue-description"))
      .toContainText(changedDescription);
    await expect(page.getByRole("treeitem", { name: changedName })).toBeVisible();

    const moved = await callMcpTool<{ ok?: boolean; status?: string }>(
      "update_task_status",
      {
        project_id: fixture.project.id,
        task_id: fixture.moving.id,
        status_name: "Grill",
      },
    );
    expect(moved).toMatchObject({ ok: true, status: "Grill" });
    await expect(page.getByTestId("status-row")).toContainText("Grill");
    await expect(page.getByRole("treeitem", { name: changedName })).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(changedName);
    await expect(page.getByTestId("issue-description"))
      .toContainText(changedDescription);
    await expect(page.getByTestId("status-row")).toContainText("Grill");

    const restored = await callMcpTool<{ ok?: boolean }>(
      "update_task",
      {
        id_or_key: fixture.moving.id,
        name: names.moving,
        description: "",
      },
    );
    expect(restored.ok).toBe(true);
    const restoredState = await callMcpTool<{ ok?: boolean; status?: string }>(
      "update_task_status",
      {
        project_id: fixture.project.id,
        task_id: fixture.moving.id,
        status_name: "Ideas",
      },
    );
    expect(restoredState).toMatchObject({ ok: true, status: "Ideas" });
    await expect(page.getByTestId("issue-name")).toContainText(names.moving);
    await expect(page.getByTestId("status-row")).toContainText("Ideas");
  });

  test("appends MCP description content without replacing the human-authored body", { tag: "@case-mcp-description-append" }, async ({
    page,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.moving);
    const baseline = "Human-authored baseline retained by append.";
    const appended = "Agent-appended Rust MCP note.";
    await editDescription(page, baseline);
    // Append only after the human save is authoritative, or it would race the save.
    await expect.poll(async () => (await callMcpTool<{ result: { description: string } }>(
      "get_task_details", { id_or_key: fixture.moving.id },
    )).result.description).toBe(baseline);

    const result = await callMcpTool<{ result?: boolean }>(
      "append_task_description",
      {
        project_id: fixture.project.id,
        task_id: fixture.moving.id,
        new_content: appended,
      },
    );
    expect(result.result).toBe(true);
    await expect(page.getByTestId("issue-description")).toContainText(baseline);
    await expect(page.getByTestId("issue-description")).toContainText(appended);

    await page.reload();
    await expect(page.getByTestId("issue-description")).toContainText(baseline);
    await expect(page.getByTestId("issue-description")).toContainText(appended);

    const restored = await callMcpTool<{ ok?: boolean }>(
      "update_task",
      {
        id_or_key: fixture.moving.id,
        description: "",
      },
    );
    expect(restored.ok).toBe(true);
    await expect(page.getByTestId("issue-description")).not.toContainText(appended);
  });

  test("keeps a human-only workflow edge closed to the Rust MCP agent", { tag: "@case-mcp-human-only-edge" }, async ({
    page,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.moving);
    await selectState(page, "Spec");
    await selectState(page, "Tickets");

    const refused = await callMcpTool<{
      ok?: boolean;
      code?: string;
      detail?: string;
      from?: string;
      to?: string;
    }>("update_task_status", {
      project_id: fixture.project.id,
      task_id: fixture.moving.id,
      status_name: "Implement",
    });
    expect(refused).toMatchObject({
      ok: false,
      code: "human_only_transition",
      from: "Tickets",
      to: "Implement",
    });
    expect(refused.detail).toMatch(/human-only/i);
    await expect(page.getByTestId("status-row")).toContainText("Tickets");

    await page.reload();
    await expect(page.getByTestId("status-row")).toContainText("Tickets");

    // The same edge remains available to an explicit human action in Studio.
    // Each move settles before the picker reopens with the new state's edges.
    await selectState(page, "Implement");
    await expect(page.getByTestId("status-row")).toContainText("Implement");
    await selectState(page, "Grill");
    await expect(page.getByTestId("status-row")).toContainText("Grill");
    await selectState(page, "Ideas");
    await page.reload();
    await expect(page.getByTestId("status-row")).toContainText("Ideas");
  });

  test("streams an MCP-created root Story into the module and deletes it through UI", { tag: "@case-mcp-root-story-stream" }, async ({
    page,
  }) => {
    await openModule(page, names.module);
    const createdName = "Root Story created through MCP";
    const createdDescription = "Created outside the UI through the Rust MCP.";
    const created = await callMcpTool<{ result?: string }>(
      "create_task",
      {
        project_id: fixture.project.id,
        module_id: fixture.module.id,
        name: createdName,
        issue_type: "Story",
        description: createdDescription,
      },
    );
    expect(created.result).toBeTruthy();

    const row = page.getByRole("treeitem", { name: createdName });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByTestId("issue-name")).toContainText(createdName);
    await expect(page.getByTestId("issue-description"))
      .toContainText(createdDescription);

    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(createdName);
    await expect(page.getByTestId("issue-description"))
      .toContainText(createdDescription);

    await page.getByRole("button", { name: "Issue actions" }).click();
    await page.getByRole("menuitem", { name: "Delete issue…" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete issue" });
    await expect(dialog).toContainText(createdName);
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("treeitem", { name: createdName })).toHaveCount(0);
  });

  test("streams MCP sub-task creation and partial reparenting into the open hierarchy", { tag: "@case-mcp-subtask-reparent" }, async ({
    page,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.hierarchyParent);
    const childName = "MCP-created hierarchy child";
    const childDescription = "Created and reparented through the Rust MCP.";
    const created = await callMcpTool<{ result?: string }>(
      "create_sub_task",
      {
        project_id: fixture.project.id,
        parent_id: fixture.hierarchyParent.id,
        name: childName,
        issue_type: "Implementation",
        description: childDescription,
      },
    );
    expect(created.result).toBeTruthy();

    const originalChildren = page.getByTestId("child-issues");
    await expect(originalChildren).toContainText(childName);
    await originalChildren.getByRole("button", {
      name: new RegExp(childName),
    }).click();
    await expect(page.getByTestId("issue-description"))
      .toContainText(childDescription);
    await expect(page.getByTestId("parent-picker").getByRole("button"))
      .toHaveText(names.hierarchyParent);

    const refusedCycle = await callMcpTool<{
      reparented?: unknown[];
      skipped?: unknown[];
      failed?: Array<{ task_id?: string; error?: string }>;
    }>("reparent_tasks", {
      project_id: fixture.project.id,
      parent_task_id: created.result,
      task_ids: [fixture.hierarchyParent.id],
    });
    expect(refusedCycle).toMatchObject({
      reparented: [],
      skipped: [],
      failed: [{
        task_id: fixture.hierarchyParent.id,
        error: expect.stringMatching(/beneath its descendant/i),
      }],
    });
    await expect(page.getByTestId("parent-picker").getByRole("button"))
      .toHaveText(names.hierarchyParent);

    await openWorkItem(page, names.hierarchyParent);
    const missingKey = "CDN-999999";
    const partiallyReparented = await callMcpTool<{
      parent_task_id?: string;
      reparented?: Array<{ task_id?: string; previous_parent_id?: string }>;
      skipped?: Array<{ task_id?: string; reason?: string }>;
      failed?: unknown[];
    }>("reparent_tasks", {
      project_id: fixture.project.id,
      parent_task_id: fixture.blocker.id,
      task_ids: [created.result, missingKey],
    });
    expect(partiallyReparented).toMatchObject({
      parent_task_id: fixture.blocker.id,
      reparented: [{
        task_id: created.result,
        previous_parent_id: fixture.hierarchyParent.id,
      }],
      skipped: [{ task_id: missingKey, reason: "not_found" }],
      failed: [],
    });
    await expect(originalChildren).not.toContainText(childName);

    await openWorkItem(page, names.blocker);
    await expect(page.getByTestId("child-issues")).toContainText(childName);
    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(names.blocker);
    const restoredChildren = page.getByTestId("child-issues");
    await expect(restoredChildren).toContainText(childName);
    await restoredChildren.getByRole("button", {
      name: new RegExp(childName),
    }).click();
    await expect(page.getByTestId("parent-picker").getByRole("button"))
      .toHaveText(names.blocker);

    await page.getByRole("button", { name: "Issue actions" }).click();
    await page.getByRole("menuitem", { name: "Delete issue…" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete issue" });
    await expect(dialog).toContainText(childName);
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("treeitem", { name: childName })).toHaveCount(0);
  });

  test("persists, guards, and clears an MCP blocker edge in both visible directions", { tag: "@case-mcp-blocker-edge" }, async ({
    page,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.moving);

    const blocked = await callMcpTool<{
      task_id?: string;
      blocked_by_ids?: string[];
      blocks_ids?: string[];
    }>("set_task_blockers", {
      task_id: fixture.moving.id,
      blocked_by_ids: [fixture.blocker.id],
    });
    expect(blocked).toMatchObject({
      task_id: fixture.moving.id,
      blocked_by_ids: [fixture.blocker.id],
    });

    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(names.moving);
    await expect(page.getByTestId("blocked-by-row"))
      .toContainText(fixture.blocker.key);
    await openWorkItem(page, names.blocker);
    await expect(page.getByTestId("blocks-row"))
      .toContainText(fixture.moving.key);

    const refusedCycle = await callMcpTool<{
      task_id?: string;
      error?: string;
    }>("set_task_blockers", {
      task_id: fixture.blocker.id,
      blocked_by_ids: [fixture.moving.id],
    });
    expect(refusedCycle.task_id).toBe(fixture.blocker.id);
    expect(refusedCycle.error).toMatch(/cycle/i);

    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(names.blocker);
    await expect(page.getByTestId("blocked-by-row").getByTestId("blocker-chip"))
      .toHaveCount(0);
    await expect(page.getByTestId("blocks-row"))
      .toContainText(fixture.moving.key);

    const cleared = await callMcpTool<{
      task_id?: string;
      blocked_by_ids?: string[];
    }>("set_task_blockers", {
      task_id: fixture.moving.id,
      blocked_by_ids: [],
    });
    expect(cleared).toMatchObject({
      task_id: fixture.moving.id,
      blocked_by_ids: [],
    });

    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(names.blocker);
    await expect(page.getByTestId("blocks-row")).toHaveCount(0);
    await openWorkItem(page, names.moving);
    await expect(page.getByTestId("blocked-by-row").getByTestId("blocker-chip"))
      .toHaveCount(0);
  });
  test("reads every project's modules, types and work through global authority without writing", { tag: "@case-mcp-global-reads" }, async ({ page, request }) => {
    const second = await createProject(request, { name: "MCP global second", slug: "MCG", description: "" });
    const before = await getWorkItems(request, fixture.project.id);
    const projects = await callMcpTool<{ result: Array<{ id: string; identifier: string }> }>("list_projects", {});
    expect(projects.result.map(project => project.identifier).sort()).toEqual(["CDN", "MCG"]);
    expect(await callMcpTool("list_modules", { project_id: second.id })).toEqual({ result: [] });
    expect(await callMcpTool("list_tasks", { project_id: second.id })).toEqual({ result: [] });
    const types = await callMcpTool<{ result: Array<{ name: string; level: string }> }>("list_issue_types", { project_id: second.id });
    expect(types.result.map(type => [type.name, type.level])).toEqual([
      ["Module", "module"], ["Story", "task"], ["PathFind", "task"], ["Implementation", "task"],
    ]);

    const modules = await callMcpTool<{ result: Array<{ id: string; name: string }> }>("list_modules", { project_id: fixture.project.id });
    expect(modules.result).toContainEqual(expect.objectContaining({ id: fixture.module.id, name: names.module }));
    const moduleTasks = await callMcpTool<{ result: Array<{ name: string }> }>("list_tasks", { project_id: fixture.project.id, module_id: fixture.nonRepoModule.id });
    expect(moduleTasks.result.map(task => task.name)).toEqual([names.nonRepoItem]);
    const byId = await callMcpTool<{ result: { key: string; name: string; description: string; state_id: string } }>("get_task_details", { id_or_key: fixture.parent.id });
    expect(byId.result).toMatchObject({ name: names.parent, description: "Original complete description", state_id: fixture.parent.state_id });
    expect(await callMcpTool("get_task_details", { id_or_key: byId.result.key })).toEqual(byId);
    const scope = await callMcpTool<{ result: { task: { id: string }; depends_on: unknown[]; depended_by: unknown[] } }>("get_task_scope_context", { id_or_key: fixture.hierarchyParent.id });
    expect(scope.result).toMatchObject({ task: { id: fixture.hierarchyParent.id }, depends_on: [], depended_by: [] });
    const graph = await callMcpTool<{ root_id: string; nodes: Array<{ id: string; parent_id: string }> }>("get_dependency_graph", { root_task_id: fixture.hierarchyParent.id });
    expect(graph.root_id).toBe(fixture.hierarchyParent.id);
    expect(graph.nodes).toContainEqual(expect.objectContaining({ id: fixture.hierarchyChild.id, parent_id: fixture.hierarchyParent.id }));
    expect(await getWorkItems(request, fixture.project.id)).toEqual(before);

    await openModule(page, names.module);
    await openWorkItem(page, names.parent);
    await expect(page.getByTestId("issue-description")).toContainText("Original complete description");
    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(names.parent);
  });

  test("refuses unauthenticated, unknown and unsupported socket handshakes and keeps serving", { tag: "@case-mcp-socket-handshake-refusals" }, async () => {
    const socket = lstatSync(join(e2eDataDirectory(), "mcp.sock"));
    expect(socket.isSocket()).toBe(true);
    expect(socket.mode & 0o777).toBe(0o600);
    expect(await mcpHandshake({ ticketry_mcp_auth: 1, mode: "run", agent_run_id: "0".repeat(32) }))
      .toEqual({ ticketry_mcp_auth: 1, ok: false, error: "caller_run_unbound", reason: "authorization_missing" });
    expect(await mcpHandshake({ ticketry_mcp_auth: 1, mode: "run" }))
      .toEqual({ ticketry_mcp_auth: 1, ok: false, error: "caller_run_unbound", reason: "handshake_run_missing" });
    expect(await mcpHandshake({ ticketry_mcp_auth: 1, mode: "admin" }))
      .toEqual({ ticketry_mcp_auth: 1, ok: false, error: "handshake_failed", reason: "handshake_mode_unknown" });
    expect(await mcpHandshake({ ticketry_mcp_auth: 2, mode: "global" }))
      .toEqual({ ticketry_mcp_auth: 1, ok: false, error: "handshake_failed", reason: "handshake_unsupported_version" });
    expect(await callMcpTool("mcp_ping", {})).toEqual({ status: "ok", server: "ticketry" });
  });

  test("discovers open sprints and assigns, creates and clears Story sprint membership", { tag: ["@case-mcp-sprint-assignment", "@edition-core"] }, async ({ page, request }) => {
    expect(await callMcpTool("list_sprints", { project_id: fixture.project.id })).toEqual({ sprints: [] });
    const name = "MCP assignment sprint";
    const sprint = (await graphql(request, CreateSprintDocument, { data: { projectId: fixture.project.id, name } })).worktrackerSprintCreateOne;
    expect(await callMcpTool("list_sprints", { project_id: fixture.project.id })).toEqual({
      sprints: [{ id: sprint.id, name, status: "planned", is_current: false, is_next: true }],
    });
    expect(await callMcpTool("update_task", { id_or_key: fixture.moving.id, sprint: "current" }))
      .toMatchObject({ ok: false, code: "no_active_sprint", field: "sprint" });
    expect(await callMcpTool("update_task", { id_or_key: fixture.moving.id, sprint: sprint.id, name: "Mixed" }))
      .toMatchObject({ ok: false, code: "mixed_sprint_update", field: "sprint" });
    const assigned = await callMcpTool("update_task", { id_or_key: fixture.moving.id, sprint: sprint.id.replace(/-/g, "") });
    expect(assigned).toMatchObject({ ok: true, updated_fields: ["sprint"], sprint: { id: sprint.id, name, status: "planned" } });
    const createdName = "MCP sprint-born Story";
    const created = await callMcpTool("create_task", {
      project_id: fixture.project.id, module_id: fixture.module.id, name: createdName, issue_type: "Story", sprint: "next",
    });
    expect(created).toMatchObject({ ok: true, sprint: { id: sprint.id, name } });

    // The Sprint scope filter is a Core-edition surface, so membership is read
    // back through public GraphQL around a reload in every edition.
    const sprintOf = async (id: string) => {
      const row = await getWorkItem(request, id) as { sprint_id?: string | null };
      return row.sprint_id ? compactId(row.sprint_id) : null;
    };
    await openModule(page, names.module);
    await expect(page.getByRole("treeitem", { name: new RegExp(createdName) })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("treeitem", { name: new RegExp(createdName) })).toBeVisible();
    expect(await sprintOf(fixture.moving.id)).toBe(compactId(sprint.id));
    expect(await sprintOf((created as { task_id: string }).task_id)).toBe(compactId(sprint.id));
    expect(await sprintOf(fixture.parent.id)).toBeNull();

    expect(await callMcpTool("update_task", { id_or_key: fixture.moving.id, sprint: null }))
      .toMatchObject({ ok: true, updated_fields: ["sprint"], sprint: null });
    await page.reload();
    await expect(page.getByRole("treeitem", { name: new RegExp(names.moving) })).toBeVisible();
    expect(await sprintOf(fixture.moving.id)).toBeNull();
    expect(await sprintOf((created as { task_id: string }).task_id)).toBe(compactId(sprint.id));
  });

  test("proves an agent move by its structured result and authoritative state readback", { tag: "@case-mcp-state-readback" }, async ({ page, request }) => {
    const states = (await getWorkflowCatalog(request, fixture.project.id)).states.nodes;
    const stateId = (name: string) => states.find(state => state.name === name)!.id;
    const details = async () => (await callMcpTool<{ result: { state_id: string } }>("get_task_details", { id_or_key: fixture.blocker.id })).result.state_id;
    expect(await details()).toBe(stateId("Ideas"));

    expect(await callMcpTool("update_task_status", { project_id: fixture.project.id, task_id: fixture.blocker.id, status_name: "Grill" }))
      .toMatchObject({ ok: true, status: "Grill" });
    expect(await details()).toBe(stateId("Grill"));
    // A move to the current state is an accepted no-op that leaves the identity unchanged.
    expect(await callMcpTool("update_task_status", { project_id: fixture.project.id, task_id: fixture.blocker.id, status_name: "Grill" }))
      .toMatchObject({ ok: true, status: "Grill" });
    expect(await details()).toBe(stateId("Grill"));
    expect(await callMcpTool("update_task_status", { project_id: fixture.project.id, task_id: fixture.blocker.id, status_name: "Nowhere" }))
      .toEqual({ ok: false, task_id: fixture.blocker.id, error: 'Unknown workflow state "Nowhere".' });
    expect(await details()).toBe(stateId("Grill"));

    await openModule(page, names.module);
    await openWorkItem(page, names.blocker);
    await expect(page.getByTestId("status-row")).toContainText("Grill");
    await page.reload();
    await expect(page.getByTestId("status-row")).toContainText("Grill");

    expect(await callMcpTool("update_task_status", { project_id: fixture.project.id, task_id: fixture.blocker.id, status_name: "Ideas" }))
      .toMatchObject({ ok: true, status: "Ideas" });
    expect(await details()).toBe(stateId("Ideas"));
    await expect(page.getByTestId("status-row")).toContainText("Ideas");
  });

  test("refuses MCP launch of unknown or unlaunchable work and global run termination without starting runs", { tag: "@case-mcp-launch-refusals" }, async ({ page, request }) => {
    expect(await callMcpTool("launch_default_coding_agent", { id_or_key: "CDN-999999" }))
      .toEqual({ ok: false, code: "not_found", detail: "Work item not found." });
    expect(await callMcpTool("terminate_current_run", {}))
      .toEqual({ ok: false, error: "caller_run_unbound", reason: "authorization_missing" });
    // A policy refusal records nothing, so reconciliation never starts the run later (CODING-2869).
    await writeFixtureControl({ mode: "success" });
    const unlinked = await createWorkItem(request, fixture.project.id, {
      name: "MCP launch without a module folder", parent_id: fixture.staleModule.id, issue_type_id: fixture.storyType.id,
    });
    const refused = await callMcpTool<{ target_id: string; error: string }>("launch_default_coding_agent", { id_or_key: unlinked.id });
    expect(compactId(refused.target_id)).toBe(compactId(unlinked.id));
    expect(refused.error).toBe("module_folder_unusable");
    await page.waitForTimeout(8_000);
    expect((await agentStatus(request, fixture.project.id)).agent_run_holdings).toEqual([]);
    expect((await graphql(request, TaskTerminalSessionsDocument, { taskId: unlinked.id, limit: 25 })).terminal_sessions.sessions).toEqual([]);
    await openModule(page, names.module);
    await expect(page.getByRole("treeitem", { name: new RegExp(names.parent) })).toBeVisible();
    await expect(page.getByTestId("agent-state-badge")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("treeitem", { name: new RegExp(names.parent) })).toBeVisible();
    await expect(page.getByTestId("agent-state-badge")).toHaveCount(0);
  });

  test("stops only the calling provider's run and keeps its ticket when it terminates itself", { tag: "@case-mcp-provider-terminates-own-run" }, async ({ page, request }) => {
    test.setTimeout(120_000);
    const bystander = await launchFixtureRun(page, names.parent, { mode: "success" });
    await expect(rowBadge(page, names.parent).getByLabel(lifecycleChip.working, { exact: true })).toBeVisible();
    const caller = await launchFixtureRun(page, names.moving, { mode: "success", startCalls: [{ name: "terminate_current_run", arguments: {} }] });
    const [termination] = await fixtureBridgeCalls(caller, 1);
    expect(termination).toEqual({ name: "terminate_current_run", result: expect.objectContaining({ ok: true, termination_requested: true, agent_run_id: caller }) });
    const { pid } = await fixtureLaunchEvidence(caller);
    await expect.poll(() => processAlive(pid), { timeout: 25_000 }).toBe(false);
    await expect.poll(async () => await runHolding(request, fixture.project.id, caller), { timeout: 25_000 }).toBeUndefined();

    const ticket = await callMcpTool<{ result: { state_id: string; is_archived: boolean } }>("get_task_details", { id_or_key: fixture.moving.id });
    expect(ticket.result).toMatchObject({ state_id: fixture.moving.state_id, is_archived: false });
    await expect(page.getByRole("treeitem", { name: new RegExp(names.moving) })).toBeVisible();
    await expect(rowBadge(page, names.moving)).toHaveCount(0);
    await expect(rowBadge(page, names.parent).getByLabel(lifecycleChip.working, { exact: true })).toBeVisible();
    expect((await runHolding(request, fixture.project.id, bystander))?.state).toBe("working");

    await page.reload();
    await expect(page.getByRole("treeitem", { name: new RegExp(names.moving) })).toBeVisible();
    await expect(rowBadge(page, names.moving)).toHaveCount(0);
    await expect(rowBadge(page, names.parent).getByLabel(lifecycleChip.working, { exact: true })).toBeVisible();

    await releaseConversation(bystander);
    await waitForAgentExit(request, fixture.parent.id, bystander);
  });
  test("serves a launched provider's bridge inside its run project and keeps the run live after the bridge disconnects", { tag: "@case-mcp-provider-run-scope" }, async ({ page, request }) => {
    test.setTimeout(120_000);
    const second = await createProject(request, { name: "MCP run foreign project", slug: "MCR", description: "" });
    const childName = "Run-scoped bridge child";
    const runId = await launchFixtureRun(page, names.parent, { mode: "success", startCalls: [
      { name: "list_projects", arguments: {} },
      { name: "list_tasks", arguments: { project_id: second.id } },
      { name: "list_tasks", arguments: { project_id: fixture.project.id, state_name: "Done" } },
      { name: "create_sub_task", arguments: { project_id: fixture.project.id, parent_id: fixture.parent.id, name: childName, issue_type: "Implementation" } },
    ] });
    const [projects, foreign, empty, child] = await fixtureBridgeCalls(runId, 4);
    expect((projects.result.result as Array<{ identifier: string }>).map(project => project.identifier)).toEqual(["CDN"]);
    expect(foreign.result).toEqual({ ok: false, detail: "The caller is not authorized for that project.", code: "foreign_scope" });
    expect(empty.result).toEqual({ result: [] });
    expect(child.result).toEqual({ result: expect.any(String) });

    // The provider's bridge has disconnected; that alone does not cancel the run.
    await expect(rowBadge(page, names.parent).getByLabel(lifecycleChip.working, { exact: true })).toBeVisible();
    expect((await runHolding(request, fixture.project.id, runId))?.state).toBe("working");
    await expect(page.getByTestId("child-issues")).toContainText(childName);
    await page.reload();
    await expect(page.getByTestId("child-issues")).toContainText(childName);
    await expect(rowBadge(page, names.parent).getByLabel(lifecycleChip.working, { exact: true })).toBeVisible();

    await releaseConversation(runId);
    await waitForAgentExit(request, fixture.parent.id, runId);
  });

  test("serves sprint goals to a launched provider and refuses its suggestion outside the current suggestion run", { tag: ["@case-mcp-provider-sprint-scope", "@edition-core"] }, async ({ page, request }) => {
    test.setTimeout(120_000);
    const sprintName = "MCP run-scoped sprint";
    const sprint = (await graphql(request, CreateSprintDocument, { data: { projectId: fixture.project.id, name: sprintName } })).worktrackerSprintCreateOne;
    const goal = (await graphql(request, CreateSprintGoalDocument, { sprintId: sprint.id, text: "Prove run-scoped goals" })).create_sprint_goal;
    const runId = await launchFixtureRun(page, names.parent, { mode: "success", startCalls: [
      { name: "get_sprint_goals", arguments: { sprint_id: sprint.id } },
      { name: "suggest_sprint_story", arguments: { sprint_id: sprint.id, goal_id: goal.id, reason: "Not a suggestion run", issue_id: fixture.parent.id } },
    ] });
    const [goals, suggestion] = await fixtureBridgeCalls(runId, 2);
    expect(goals.result).toMatchObject({ name: sprintName, status: "planned", goals: [{ number: "G1", text: "Prove run-scoped goals" }] });
    expect(suggestion.result).toEqual({ ok: false, detail: "The suggestion run is no longer current.", code: "run_not_current" });

    await expect(rowBadge(page, names.parent).getByLabel(lifecycleChip.working, { exact: true })).toBeVisible();
    await releaseConversation(runId);
    await waitForAgentExit(request, fixture.parent.id, runId);
  });

  test("starts the packaged bridge in exactly one authority mode and refuses malformed run authority", { tag: "@case-mcp-bridge-authority-modes" }, async ({ page, request }) => {
    test.setTimeout(120_000);
    const runId = await launchFixtureRun(page, names.parent, { mode: "success" });
    const { executable } = await launchHook(runId);
    const dataDirectory = e2eDataDirectory();

    let projects: Array<{ identifier: string }> | undefined;
    await withProviderMcp(executable, ["mcp", "--data-dir", dataDirectory, "--global"], async (send: (method: string, params: unknown) => Promise<{ result?: { structuredContent?: { result: Array<{ identifier: string }> } } }>) => {
      projects = (await send("tools/call", { name: "list_projects", arguments: {} })).result?.structuredContent?.result;
    });
    expect(projects?.map(project => project.identifier)).toEqual(["CDN"]);
    expect(await bridgeInitialize(executable, ["mcp", "--data-dir", dataDirectory, "--agent-run-id", runId], { TICKETRY_MCP_AUTHORIZATION: "not-a-credential" }))
      .toEqual({ jsonrpc: "2.0", id: 1, error: { code: -32001, message: "Ticketry MCP is unavailable", data: { code: "authorization_malformed" } } });
    expect(runBridge(executable, ["mcp", "--data-dir", dataDirectory, "--agent-run-id", runId]))
      .toEqual({ status: 1, stdout: "", stderr: "ticketry-hook mcp stopped: TICKETRY_MCP_AUTHORIZATION is required\n" });
    expect(runBridge(executable, ["mcp", "--data-dir", dataDirectory, "--global", "--agent-run-id", runId]))
      .toEqual({ status: 2, stdout: "", stderr: "ticketry-hook: mcp requires exactly one of --global and a valid --agent-run-id\n" });
    expect(runBridge(executable, ["mcp", "--data-dir", "relative-data", "--global"]))
      .toEqual({ status: 2, stdout: "", stderr: "ticketry-hook: mcp requires an absolute data directory\n" });

    await expect(rowBadge(page, names.parent).getByLabel(lifecycleChip.working, { exact: true })).toBeVisible();
    await releaseConversation(runId);
    await waitForAgentExit(request, fixture.parent.id, runId);
  });

  test("edits agent transition policy at the current revision and refuses stale or unknown policy", { tag: "@case-mcp-workflow-policy" }, async ({ page, request }) => {
    const catalog = await getWorkflowCatalog(request, fixture.project.id);
    const stateId = (name: string) => catalog.states.nodes.find(state => state.name === name)!.id;
    const moduleType = catalog.issue_types.nodes.find(type => type.level === "module")!;
    expect(await callMcpTool("get_issue_type_workflow_settings", { type_id: moduleType.id }))
      .toMatchObject({ issue_type_id: moduleType.id, workflow_revision: 0, transitions: [], launch_bindings: [] });
    expect(await callMcpTool("get_issue_type_workflow_settings", { type_id: "00000000-0000-0000-0000-000000000000" }))
      .toEqual({ ok: false, detail: "Work-item type not found.", code: "not_found" });

    type Policy = { workflow_revision: number; start_state_id: string; transitions: Array<{ from_state_id: string; to_state_id: string; agent_allowed: boolean }> };
    const edge = (policy: Policy) => policy.transitions.find(row => row.from_state_id === stateId("Ideas") && row.to_state_id === stateId("Grill"));
    const before = await callMcpTool<Policy>("get_issue_type_workflow_settings", { type_id: fixture.storyType.id });
    expect(before.start_state_id).toBe(stateId("Ideas"));
    expect(edge(before)?.agent_allowed).toBe(true);
    const permission = (agentAllowed: boolean, revision: number) => callMcpTool<Policy & { ok?: boolean; code?: string }>("set_issue_type_workflow_transition_permission", {
      type_id: fixture.storyType.id, from_state_id: stateId("Ideas"), to_state_id: stateId("Grill"), agent_allowed: agentAllowed, workflow_revision: revision,
    });
    expect(await permission(false, before.workflow_revision - 1))
      .toEqual({ ok: false, detail: "Workflow revision is stale; read the current workflow and retry.", code: "stale_revision" });
    const closed = await permission(false, before.workflow_revision);
    expect(closed.workflow_revision).toBe(before.workflow_revision + 1);
    expect(edge(closed)?.agent_allowed).toBe(false);
    expect(await callMcpTool("update_task_status", { project_id: fixture.project.id, task_id: fixture.blocker.id, status_name: "Grill" }))
      .toMatchObject({ ok: false, code: "human_only_transition", from: "Ideas", to: "Grill" });

    const openPolicy = async () => {
      await page.getByRole("button", { name: "Configure Ideas state", exact: true }).click();
      const panel = page.getByTestId("state-configuration-panel");
      await panel.getByRole("tab", { name: "Story", exact: true }).click();
      return panel.getByRole("checkbox", { name: "Agents may move Ideas to Grill", exact: true });
    };
    await openModule(page, names.module);
    await expect(await openPolicy()).not.toBeChecked();
    await page.reload();
    await expect(await openPolicy()).not.toBeChecked();
    await openWorkItem(page, names.blocker);
    await expect(page.getByTestId("status-row")).toContainText("Ideas");

    const reopened = await permission(true, closed.workflow_revision);
    expect(edge(reopened)?.agent_allowed).toBe(true);
    await page.reload();
    await expect(await openPolicy()).toBeChecked();
  });

  test("adds deduplicated tags and dependency edges through their dedicated tools", { tag: "@case-mcp-tags-and-dependencies" }, async ({ page }) => {
    expect(await callMcpTool("add_task_tags", { id_or_key: fixture.moving.id, tags: ["mcp", "mcp", "agent"] }))
      .toMatchObject({ ok: true, task_id: fixture.moving.id, tags: ["agent", "mcp"] });
    expect(await callMcpTool("add_task_tags", { id_or_key: fixture.moving.id, tags: "mcp" }))
      .toEqual({ ok: false, detail: "tags must be an array.", code: "field_validation", field: "tags" });
    expect(await callMcpTool("add_task_dependent", { task_id: fixture.blocker.id, dependent_task_id: fixture.moving.id }))
      .toEqual({ task_id: fixture.moving.id, blocked_by_ids: [fixture.blocker.id], blocks_ids: [] });
    expect(await callMcpTool("add_task_blocker", { task_id: fixture.moving.id, blocker_task_id: fixture.blocker.id }))
      .toEqual({ task_id: fixture.moving.id, blocked_by_ids: [fixture.blocker.id], blocks_ids: [] });
    expect(await callMcpTool("add_task_blocker", { task_id: fixture.blocker.id, blocker_task_id: fixture.moving.id }))
      .toEqual({ task_id: fixture.blocker.id, error: "That blocker would create a cycle." });
    expect(await callMcpTool("get_task_scope_context", { id_or_key: fixture.moving.id }))
      .toMatchObject({ result: { depends_on: [{ id: fixture.blocker.id, name: names.blocker }], depended_by: [] } });

    await openModule(page, names.module);
    await openWorkItem(page, names.moving);
    await expect(page.getByTestId("blocked-by-row")).toContainText(fixture.blocker.key);
    await page.reload();
    await expect(page.getByTestId("blocked-by-row")).toContainText(fixture.blocker.key);
    // Tags have no Studio surface; a later call returns the stored union.
    expect(await callMcpTool("add_task_tags", { id_or_key: fixture.moving.id, tags: ["review"] }))
      .toMatchObject({ ok: true, tags: ["agent", "mcp", "review"] });

    expect(await callMcpTool("set_task_blockers", { task_id: fixture.moving.id, blocked_by_ids: [] }))
      .toMatchObject({ task_id: fixture.moving.id, blocked_by_ids: [] });
    await page.reload();
    await expect(page.getByTestId("blocked-by-row").getByTestId("blocker-chip")).toHaveCount(0);
  });
  test("launches the default coding agent through MCP into one live run on the Story", { tag: "@case-mcp-default-agent-launch" }, async ({ page, request }) => {
    test.setTimeout(120_000);
    await writeFixtureControl({ mode: "success" });
    const story = await createWorkItem(request, fixture.project.id, {
      name: "MCP default-agent launch", parent_id: fixture.module.id, issue_type_id: fixture.storyType.id,
    });
    await openModule(page, names.module);
    await openWorkItem(page, story.name);
    const launched = await callMcpTool<{ target_id: string; agent: string; agent_run_id: string }>("launch_default_coding_agent", { id_or_key: story.id });
    expect(compactId(launched.target_id)).toBe(compactId(story.id));
    expect(launched.agent).toBe("codex");
    const runId = launched.agent_run_id;
    expect((await fixtureLaunchEvidence(runId)).runId).toBe(runId);
    await expect(rowBadge(page, story.name).getByLabel(lifecycleChip.working, { exact: true })).toBeVisible();
    await expect.poll(async () => (await runHolding(request, fixture.project.id, runId))?.state).toBe("working");
    // The launch does not move the Story, and nothing launches it a second time.
    await expect(page.getByTestId("status-row")).toContainText("Ideas");
    await page.reload();
    await expect(rowBadge(page, story.name).getByLabel(lifecycleChip.working, { exact: true })).toBeVisible();
    const sessions = async () => (await graphql(request, TaskTerminalSessionsDocument, { taskId: story.id, limit: 25 })).terminal_sessions.sessions.map(row => row.agent_run_id);
    expect(await sessions()).toEqual([runId]);

    await releaseConversation(runId);
    await waitForAgentExit(request, story.id, runId);
    await expect(rowBadge(page, story.name)).toHaveCount(0);
    const ended = await graphql(request, TaskResumableTerminalSessionsDocument, { taskId: story.id });
    expect(ended.resumable_sessions.map(row => row.agent_run_id)).toEqual([runId]);
  });

  test("converts an eligible Story and launches it through MCP Run Now", { tag: "@case-mcp-run-now" }, async ({ page, request }) => {
    test.setTimeout(120_000);
    await writeFixtureControl({ mode: "success" });
    const story = await createWorkItem(request, fixture.project.id, {
      name: "MCP Run Now Story", parent_id: fixture.module.id, issue_type_id: fixture.storyType.id,
    });
    await openModule(page, names.module);
    await openWorkItem(page, story.name);
    const converted = await callMcpTool<{ committed_state: { name: string } | null; committed_issue_type: { name: string } | null }>("run_now", { id_or_key: story.id });
    expect(converted).toMatchObject({ committed_state: { name: "Implement" }, committed_issue_type: { name: "Implementation" } });
    await expect(page.getByTestId("status-row")).toContainText("Implement");
    expect((await getWorkItem(request, story.id)).id).toBe(story.id);
    const sessions = async () => (await graphql(request, TaskTerminalSessionsDocument, { taskId: story.id, limit: 25 })).terminal_sessions.sessions;
    await expect.poll(async () => (await sessions()).length).toBe(1);
    const [{ agent_run_id: runId }] = await sessions();
    await expect(rowBadge(page, story.name).getByLabel(lifecycleChip.working, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("status-row")).toContainText("Implement");
    await expect(rowBadge(page, story.name).getByLabel(lifecycleChip.working, { exact: true })).toBeVisible();

    await releaseConversation(runId);
    await waitForAgentExit(request, story.id, runId);
  });
});
