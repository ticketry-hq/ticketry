import { expect, test, type Page, type Route } from "@playwright/test";
import { featureSuite } from "./featureSuite";
import { graphql } from "../support";
import { TaskResumableTerminalSessionsDocument } from "../../src/features/agents/terminal/generated/terminalSessions.documents";
import { holdProvider, providerEvidence, releaseProvider } from "../multi-surface-journeys-support";
import { waitForAgent, waitForAgentExit } from "../agent-lifecycle-support";
import { observeConversationLaunch } from "../conversation-support";
import {
  detailsTab, killTmuxSession, liveRunIds, openTicketModule, openTicketShell, runInTerminal, selectTicket, shellTab, terminalFixture, tmuxSessions,
  visibleHost, visibleViewer, workspaceTabs,
} from "../ticket-terminals-support";

let f: Awaited<ReturnType<typeof terminalFixture>>;
const codexTab = (page: Page) => workspaceTabs(page).getByRole("tab", { name: /codex terminal/ });
// The fixture prints Codex's composer marker once its real tmux pane is ready.
const composerMarker = "› Ask Codex";

async function launchHeldAgent(page: Page) {
  await holdProvider();
  const launch = await observeConversationLaunch(page, () => page.getByRole("button", { name: "Run item", exact: true }).click());
  await providerEvidence(launch.runId);
  return launch.runId;
}

async function closeTab(tab: ReturnType<typeof shellTab>) {
  await tab.getByRole("button", { name: /^Close / }).click();
  await expect(tab).toHaveCount(0);
}

featureSuite("ticket-terminals", () => {
  test.beforeAll(async ({ request }) => { f = await terminalFixture(request); });
  test.afterAll(async () => { await f?.cleanup(); });

  test("opens a ticket shell from Issue actions and renders real xterm input and output across reload", { tag: "@case-ticket-terminal-shell-io" }, async ({ page, request }) => {
    test.setTimeout(90_000);
    const story = await f.story(request, "Terminal shell input story");
    let creates = 0;
    page.on("request", (sent) => { if (sent.url().endsWith("/graphql") && sent.postDataJSON()?.operationName === "CreateWorkItemShell") creates++; });
    await openTicketModule(page, f.module.name);
    await selectTicket(page, story.name);

    // Escape dismisses the actions menu without launching a shell.
    await page.getByRole("button", { name: "Issue actions", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Open terminal", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu", { name: "Issue actions" })).toHaveCount(0);
    expect(creates).toBe(0);
    await expect(shellTab(page)).toHaveCount(0);
    expect(await liveRunIds(request, story.id)).toEqual([]);

    const runId = await openTicketShell(page);
    await expect(shellTab(page)).toHaveCount(1);
    await shellTab(page).click();
    await expect(shellTab(page)).toHaveAttribute("aria-selected", "true");
    await expect(visibleViewer(page)).toHaveAttribute("data-terminal-run-id", runId);
    // Browser development renders xterm over the browserTerminalClient WebSocket.
    await expect(visibleViewer(page).getByTestId("terminal-host")).toBeVisible();
    await expect(page.getByTestId("native-terminal-host")).toHaveCount(0);
    await expect(page.getByTestId("terminal-renderer-pending")).toHaveCount(0);
    await expect(page.getByTestId("native-terminal-fallback-notice")).toHaveCount(0);
    await runInTerminal(page, "echo ticket-shell-$((6*7))", "ticket-shell-42");
    expect(await tmuxSessions()).toContain(`pt-${runId}`);

    // Leave typing, then walk the workspace tabs by keyboard.
    await page.keyboard.press("Meta+Escape");
    await page.keyboard.press("Meta+ArrowLeft");
    await expect(detailsTab(page)).toHaveAttribute("aria-selected", "true");
    await expect(visibleHost(page)).toHaveCount(0);
    await page.keyboard.press("Meta+ArrowRight");
    await expect(shellTab(page)).toHaveAttribute("aria-selected", "true");
    await expect(visibleHost(page)).toContainText("ticket-shell-42");

    await page.reload();
    await selectTicket(page, story.name);
    await shellTab(page).click();
    await expect(visibleViewer(page)).toHaveAttribute("data-terminal-run-id", runId);
    // tmux redraws the same durable pane: earlier output and the shell survive.
    await expect(visibleHost(page)).toContainText("ticket-shell-42");
    await runInTerminal(page, "echo after-reload-$((5+5))", "after-reload-10");
    expect(await liveRunIds(request, story.id)).toEqual([runId]);
    expect(creates).toBe(1);
    await closeTab(shellTab(page));
  });

  test("keeps a ticket's terminal viewer mounted while another ticket and Details are selected", { tag: "@case-ticket-terminal-retention" }, async ({ page, request }) => {
    test.setTimeout(90_000);
    const story = await f.story(request, "Terminal retention story");
    const other = await f.story(request, "Terminal empty story");
    await openTicketModule(page, f.module.name);
    await selectTicket(page, story.name);
    const runId = await openTicketShell(page);
    await shellTab(page).click();
    await runInTerminal(page, "echo retained-$((9*9))", "retained-81");
    const viewer = page.locator(`[data-testid="retained-terminal-viewer"][data-terminal-run-id="${runId}"]`);
    const node = await viewer.elementHandle();
    expect(node).toBeTruthy();
    await expect(visibleViewer(page)).toHaveCount(1);
    await expect(visibleHost(page)).toHaveCount(1);

    // A ticket with no terminals shows Details only and no visible viewer.
    await selectTicket(page, other.name);
    await expect(workspaceTabs(page).getByRole("tab")).toHaveCount(1);
    await expect(detailsTab(page)).toHaveAttribute("aria-selected", "true");
    await expect(visibleViewer(page)).toHaveCount(0);
    await expect(visibleHost(page)).toHaveCount(0);
    expect(await liveRunIds(request, other.id)).toEqual([]);
    expect(await node!.evaluate((element) => element.isConnected)).toBe(true);

    await selectTicket(page, story.name);
    await expect(shellTab(page)).toHaveAttribute("aria-selected", "true");
    await expect(visibleViewer(page)).toHaveAttribute("data-terminal-run-id", runId);
    expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
    await expect(visibleHost(page)).toContainText("retained-81");
    await detailsTab(page).click();
    await expect(visibleViewer(page)).toHaveCount(0);
    expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
    await shellTab(page).click();
    // One foreground viewer presents the run; it was hidden, never rebuilt.
    await expect(visibleViewer(page)).toHaveCount(1);
    await expect(visibleHost(page)).toHaveCount(1);
    expect(await node!.evaluate((element) => element.isConnected)).toBe(true);

    await page.reload();
    await selectTicket(page, story.name);
    await expect(shellTab(page)).toHaveAttribute("aria-selected", "true");
    await expect(visibleViewer(page)).toHaveAttribute("data-terminal-run-id", runId);
    await expect(visibleHost(page)).toContainText("retained-81");
    await closeTab(shellTab(page));
  });

  test("cycles live agent terminals across tickets with the terminal chords", { tag: "@case-ticket-terminal-live-cycle" }, async ({ page, request }) => {
    test.setTimeout(150_000);
    const first = await f.story(request, "Terminal cycle first story");
    const second = await f.story(request, "Terminal cycle second story");
    await openTicketModule(page, f.module.name);
    await selectTicket(page, first.name);
    const firstRun = await launchHeldAgent(page);
    await waitForAgent(request, f.project.id, first.id);
    await selectTicket(page, second.name);
    const secondRun = await launchHeldAgent(page);
    await waitForAgent(request, f.project.id, second.id);
    try {
      await codexTab(page).click();
      await expect(visibleViewer(page)).toHaveAttribute("data-terminal-run-id", secondRun);
      await expect(visibleHost(page)).toContainText(composerMarker);
      // Engage, then leave typing with Cmd+Escape before cycling.
      await visibleHost(page).click();
      await page.keyboard.press("Meta+Escape");
      await page.keyboard.press("Meta+Backslash");
      await expect(page.getByTestId("issue-name")).toContainText(first.name);
      await expect(codexTab(page)).toHaveAttribute("aria-selected", "true");
      await expect(visibleViewer(page)).toHaveAttribute("data-terminal-run-id", firstRun);
      await expect(visibleHost(page)).toContainText(composerMarker);

      await page.keyboard.press("Meta+Shift+Backslash");
      await expect(page.getByTestId("issue-name")).toContainText(second.name);
      await expect(codexTab(page)).toHaveAttribute("aria-selected", "true");
      await expect(visibleViewer(page)).toHaveAttribute("data-terminal-run-id", secondRun);
      expect(await liveRunIds(request, first.id)).toEqual([firstRun]);
      expect(await liveRunIds(request, second.id)).toEqual([secondRun]);
    } finally {
      await releaseProvider(firstRun);
      await releaseProvider(secondRun);
    }
    await waitForAgentExit(request, first.id, firstRun);
    await waitForAgentExit(request, second.id, secondRun);
  });

  test("presents a pending viewer until a delayed agent launch is acknowledged and restores it after reload", { tag: "@case-ticket-terminal-pending" }, async ({ page, request }) => {
    test.setTimeout(90_000);
    const story = await f.story(request, "Terminal pending story");
    await openTicketModule(page, f.module.name);
    await selectTicket(page, story.name);
    await holdProvider();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let delivered = false;
    // The real server response is only delayed, never replaced.
    const delay = async (route: Route) => {
      if (route.request().postDataJSON()?.operationName !== "CreateTerminalSession") return route.continue();
      const response = await route.fetch();
      await held;
      await route.fulfill({ response });
      delivered = true;
    };
    await page.route("**/graphql", delay);
    await page.getByRole("button", { name: "Run item", exact: true }).click();
    await expect.poll(() => liveRunIds(request, story.id)).toHaveLength(1);
    const [runId] = await liveRunIds(request, story.id);
    await expect(codexTab(page)).toHaveAttribute("aria-selected", "true");
    await expect(visibleViewer(page).getByTestId("terminal-viewer-pending")).toBeVisible();
    await expect(visibleHost(page)).toHaveCount(0);
    expect(delivered).toBe(false);
    release();
    await expect(visibleViewer(page)).toHaveAttribute("data-terminal-run-id", runId!);
    await expect(page.getByTestId("terminal-viewer-pending")).toHaveCount(0);
    await expect(visibleHost(page)).toContainText(composerMarker);
    await page.unroute("**/graphql", delay);
    // A reload rebuilds the viewer for the same durable run and tmux pane.
    await page.reload();
    await selectTicket(page, story.name);
    await codexTab(page).click();
    await expect(visibleViewer(page)).toHaveAttribute("data-terminal-run-id", runId!);
    await expect(visibleHost(page)).toContainText(composerMarker);
    expect(await liveRunIds(request, story.id)).toEqual([runId]);
    expect(await tmuxSessions()).toContain(`pt-${runId}`);
    await releaseProvider(runId!);
    await waitForAgentExit(request, story.id, runId!);
  });

  test("reports a refused ticket shell launch and opens one on retry", { tag: "@case-ticket-terminal-create-recovery" }, async ({ page, request }) => {
    test.setTimeout(90_000);
    const story = await f.story(request, "Terminal launch recovery story");
    await openTicketModule(page, f.module.name);
    await selectTicket(page, story.name);
    const refuse = async (route: Route) => {
      if (route.request().postDataJSON()?.operationName !== "CreateWorkItemShell") return route.continue();
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message: "Shell launch refused" }] }) });
    };
    await page.route("**/graphql", refuse);
    await page.getByRole("button", { name: "Issue actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Open terminal", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Terminal could not be opened: Shell launch refused" })).toBeVisible();
    await expect(shellTab(page)).toHaveCount(0);
    await expect(visibleViewer(page)).toHaveCount(0);
    expect(await liveRunIds(request, story.id)).toEqual([]);
    await page.unroute("**/graphql", refuse);

    const runId = await openTicketShell(page);
    await shellTab(page).click();
    await expect(visibleViewer(page)).toHaveAttribute("data-terminal-run-id", runId);
    await runInTerminal(page, "echo recovered-$((3*4))", "recovered-12");
    expect(await liveRunIds(request, story.id)).toEqual([runId]);
    await page.reload();
    await selectTicket(page, story.name);
    await expect(shellTab(page)).toHaveCount(1);
    await closeTab(shellTab(page));
  });

  test("keeps a ticket terminal when closing is refused and ends its tmux session on retry", { tag: "@case-ticket-terminal-close-recovery" }, async ({ page, request }) => {
    test.setTimeout(90_000);
    const story = await f.story(request, "Terminal close recovery story");
    await openTicketModule(page, f.module.name);
    await selectTicket(page, story.name);
    const runId = await openTicketShell(page);
    await shellTab(page).click();
    await runInTerminal(page, "echo before-close-$((2*8))", "before-close-16");
    const refuse = async (route: Route) => {
      if (route.request().postDataJSON()?.operationName !== "UpdateTerminalSession") return route.continue();
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message: "Terminal closure refused" }] }) });
    };
    await page.route("**/graphql", refuse);
    await shellTab(page).getByRole("button", { name: /^Close / }).click();
    await expect(page.getByText(/Terminal could not be closed:/)).toBeVisible();
    await expect(shellTab(page)).toHaveCount(1);
    // The same run and tmux session still take input.
    await shellTab(page).click();
    await expect(visibleViewer(page)).toHaveAttribute("data-terminal-run-id", runId);
    await runInTerminal(page, "echo still-open-$((4*4))", "still-open-16");
    expect(await liveRunIds(request, story.id)).toEqual([runId]);
    expect(await tmuxSessions()).toContain(`pt-${runId}`);
    await page.unroute("**/graphql", refuse);

    await closeTab(shellTab(page));
    await expect.poll(() => liveRunIds(request, story.id)).toEqual([]);
    await expect.poll(tmuxSessions).not.toContain(`pt-${runId}`);
    await page.getByTestId("dormant-tabs-trigger").click();
    await expect(page.getByRole("menuitem", { name: /^Terminated / })).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.reload();
    await selectTicket(page, story.name);
    await expect(shellTab(page)).toHaveCount(0);
    await expect(visibleViewer(page)).toHaveCount(0);
  });

  test("moves completed and externally lost agent terminals into run history", { tag: "@case-ticket-terminal-ended-history" }, async ({ page, request }) => {
    test.setTimeout(150_000);
    const story = await f.story(request, "Terminal ended history story");
    await openTicketModule(page, f.module.name);
    await selectTicket(page, story.name);

    // A completed run leaves the strip and becomes resumable history.
    const completed = await launchHeldAgent(page);
    await waitForAgent(request, f.project.id, story.id);
    await codexTab(page).click();
    await expect(visibleHost(page)).toContainText(composerMarker);
    await releaseProvider(completed);
    await waitForAgentExit(request, story.id, completed);
    await expect(codexTab(page)).toHaveCount(0);
    await expect(visibleViewer(page)).toHaveCount(0);
    await expect(detailsTab(page)).toHaveAttribute("aria-selected", "true");
    await page.getByTestId("dormant-tabs-trigger").click();
    await expect(page.getByRole("menuitem", { name: /^Resume .*codex/ })).toHaveCount(1);
    await expect(page.getByRole("menuitem", { name: /^Resume .*codex/ })).toBeEnabled();
    await page.keyboard.press("Escape");

    // A tmux session killed outside Ticketry leaves no live terminal behind.
    const lost = await launchHeldAgent(page);
    await waitForAgent(request, f.project.id, story.id);
    await codexTab(page).click();
    await expect(visibleViewer(page)).toHaveAttribute("data-terminal-run-id", lost);
    await expect(visibleHost(page)).toContainText(composerMarker);
    await killTmuxSession(`pt-${lost}`);
    // Backend reconciliation retires the lost run within its sweep interval.
    await expect(codexTab(page)).toHaveCount(0, { timeout: 30_000 });
    await expect(visibleViewer(page)).toHaveCount(0);
    await expect.poll(() => liveRunIds(request, story.id)).toEqual([]);
    await expect.poll(async () => (await graphql(request, TaskResumableTerminalSessionsDocument, { taskId: story.id })).resumable_sessions
      .find((run) => run.agent_run_id === lost)?.ended_at ?? null).not.toBeNull();

    await page.reload();
    await selectTicket(page, story.name);
    await expect(codexTab(page)).toHaveCount(0);
    const history = (await graphql(request, TaskResumableTerminalSessionsDocument, { taskId: story.id })).resumable_sessions;
    expect(history.find((run) => run.agent_run_id === completed)?.ended_at).toBeTruthy();
    await page.getByTestId("dormant-tabs-trigger").click();
    await expect(page.getByRole("menuitem", { name: /^(Resume|Terminated) .*codex/ })).toHaveCount(2);
    await page.keyboard.press("Escape");
  });
});
