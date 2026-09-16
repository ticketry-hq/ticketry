/**
 * Arrow-hold selection profile.
 *
 * Starts on the first story of a module, then fires ArrowDown as fast as a held
 * key would auto-repeat and records where the time goes: how long each keydown
 * blocks the renderer, which long tasks fire, every in-app probe point
 * (`recordSelectionProfilePoint`), and every GraphQL round-trip with its
 * queue and server time. The report lands in the test attachments and on
 * stdout. Run with `npx playwright test e2e/arrow-hold-profile.spec.ts`.
 */
import { expect, test, type Page, type Request } from "@playwright/test";
import {
  acknowledgeOnboarding,
  createModule,
  createProject,
  createWorkItem,
  getModules,
  getProjects,
  getWorkflowCatalog,
  getWorkItems,
  selectModuleForProfile,
} from "./support";

const STORY_COUNT = Number(process.env.ARROW_HOLD_STORIES ?? 30);
const REPEAT_MS = Number(process.env.ARROW_HOLD_REPEAT_MS ?? 33);
const MODULE_NAME = "Arrow Hold Profile";
const storyName = (index: number) =>
  `Hold story ${String(index + 1).padStart(2, "0")}`;

type Probe = { point: string; t: number };
type LongTask = { start: number; duration: number };
type GraphqlCall = {
  op: string;
  start: number;
  end: number | null;
  status: number | null;
};
type Press = { index: number; start: number; blockedMs: number };

declare global {
  interface Window {
    __arrowHold: { probes: Probe[]; longTasks: LongTask[]; origin: number };
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  await acknowledgeOnboarding(request);
  const project = (await getProjects(request)).find((p) => p.slug === "CDN")
    ?? await createProject(request, { name: "Coding", slug: "CDN", description: "" });
  const catalog = await getWorkflowCatalog(request, project.id);
  const types = catalog.issue_types.nodes;
  const moduleType = types.find((t) => t.level === "module" || t.name === "Module")!;
  const storyType = types.find((t) => t.name === "Story")!;
  const module = (await getModules(request, project.id)).find((m) => m.name === MODULE_NAME)
    ?? await createModule(request, project.id, { name: MODULE_NAME, issue_type_id: moduleType.id });
  await selectModuleForProfile(request, project.id, module.id, process.cwd());
  const existing = new Set((await getWorkItems(request, project.id)).map((i) => i.name));
  for (let i = 0; i < STORY_COUNT; i += 1) {
    if (existing.has(storyName(i))) continue;
    await createWorkItem(request, project.id, {
      name: storyName(i),
      parent_id: module.id,
      issue_type_id: storyType.id,
    });
  }
});

test("holding ArrowDown from the first story: where the time goes", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const origin = performance.timeOrigin;
    window.__arrowHold = { probes: [], longTasks: [], origin };
    (window as unknown as { __ticketrySelectionProfileProbe: (p: string) => void })
      .__ticketrySelectionProfileProbe = (point) => {
        window.__arrowHold.probes.push({ point, t: origin + performance.now() });
      };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__arrowHold.longTasks.push({
          start: origin + entry.startTime,
          duration: entry.duration,
        });
      }
    }).observe({ type: "longtask", buffered: true });
  });

  const calls = new Map<Request, GraphqlCall>();
  page.on("request", (req) => {
    if (!req.url().endsWith("/graphql")) return;
    const op = req.postDataJSON()?.operationName ?? "?";
    calls.set(req, { op, start: Date.now(), end: null, status: null });
  });
  page.on("response", (res) => {
    const call = calls.get(res.request());
    if (call) { call.end = Date.now(); call.status = res.status(); }
  });

  await page.goto("/");
  const moduleTab = page.getByRole("tab", { name: MODULE_NAME }).last();
  await expect(moduleTab).toBeVisible();
  await moduleTab.click();
  const rows = page.getByRole("treeitem").filter({ hasText: /Hold story/ });
  await expect(rows).toHaveCount(STORY_COUNT, { timeout: 20_000 });
  // Tree order is rank order, not creation order, so start from whatever row
  // is visually first and hold down to whatever is visually last.
  const firstName = (await rows.first().innerText()).trim();
  const lastName = (await rows.last().innerText()).trim();
  await rows.first().click();
  await expect(page.getByTestId("issue-name")).toContainText(firstName.replace(/^T-\d+ · /, ""));
  // Let the first selection's queries drain so the hold starts from idle.
  // (networkidle never fires here: the app holds a websocket and GraphQL
  // subscription streams open.)
  await settle(page, calls);
  calls.clear();

  const holdStart = Date.now();
  const presses: Press[] = [];
  for (let i = 1; i < STORY_COUNT; i += 1) {
    const start = Date.now();
    // Chromium acks the key only after the renderer ran its keydown handlers,
    // so this wall time is how long the main thread was busy for that press.
    await page.keyboard.press("ArrowDown");
    const blockedMs = Date.now() - start;
    presses.push({ index: i, start, blockedMs });
    const remaining = REPEAT_MS - blockedMs;
    if (remaining > 0) await page.waitForTimeout(remaining);
  }
  const holdEnd = Date.now();

  await expect.soft(rows.last()).toHaveAttribute("aria-selected", "true");
  const selectedAt = Date.now();
  await expect.soft(page.getByTestId("issue-name"))
    .toContainText(lastName.replace(/^T-\d+ · /, ""));
  const detailsAt = Date.now();
  const selectedNow = (await page.locator('[role="treeitem"][aria-selected="true"]').allInnerTexts())
    .map((text) => text.trim());
  await settle(page, calls);
  const idleAt = Date.now();

  const captured = await page.evaluate(() => window.__arrowHold);
  const report = buildReport({
    firstName, lastName, selectedNow,
    presses, holdStart, holdEnd, selectedAt, detailsAt, idleAt,
    probes: captured.probes, longTasks: captured.longTasks,
    calls: [...calls.values()],
  });
  console.log(report.text);
  await testInfo.attach("arrow-hold-profile.md", { body: report.text, contentType: "text/markdown" });
  await testInfo.attach("arrow-hold-profile.json", {
    body: JSON.stringify(report.raw, null, 2),
    contentType: "application/json",
  });
});

/** Resolves once no GraphQL request has been in flight for 500ms. */
async function settle(page: Page, calls: Map<Request, GraphqlCall>): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const open = [...calls.values()].filter((c) => c.end === null);
    const lastEnd = Math.max(0, ...[...calls.values()].map((c) => c.end ?? 0));
    if (open.length === 0 && Date.now() - lastEnd > 500) return;
    await page.waitForTimeout(100);
  }
}

function stats(values: number[]) {
  if (values.length === 0) return { n: 0, p50: 0, p95: 0, max: 0, sum: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    n: values.length,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1],
    sum: values.reduce((a, b) => a + b, 0),
  };
}

function buildReport(input: {
  firstName: string; lastName: string; selectedNow: string[];
  presses: Press[];
  holdStart: number; holdEnd: number; selectedAt: number; detailsAt: number; idleAt: number;
  probes: Probe[]; longTasks: LongTask[]; calls: GraphqlCall[];
}) {
  const { firstName, lastName, selectedNow, presses, holdStart, holdEnd, selectedAt, detailsAt, idleAt, probes, longTasks, calls } = input;
  const rel = (t: number) => `${(t - holdStart).toFixed(0)}ms`;
  const lines: string[] = [];
  lines.push(`# Arrow-hold profile (${presses.length} presses, ${REPEAT_MS}ms repeat)`);
  lines.push("");
  lines.push(`Started on "${firstName}", target "${lastName}", selected after the hold: ${JSON.stringify(selectedNow)}.`);
  lines.push(`Hold lasted ${holdEnd - holdStart}ms. Last row selected +${selectedAt - holdEnd}ms after the last press, details showed the last story +${detailsAt - holdEnd}ms, network idle +${idleAt - holdEnd}ms.`);
  lines.push("");

  const blocked = stats(presses.map((p) => p.blockedMs));
  lines.push("## Keydown main-thread blocking (ms per press)");
  lines.push(`n=${blocked.n} p50=${blocked.p50} p95=${blocked.p95} max=${blocked.max} total=${blocked.sum}`);
  const slow = presses.filter((p) => p.blockedMs >= 50);
  if (slow.length) {
    lines.push("Presses that blocked >= 50ms, with the probe points and GraphQL responses that landed inside them:");
    for (const press of slow) {
      const end = press.start + press.blockedMs;
      const inside = probes.filter((p) => p.t >= press.start && p.t <= end);
      const counts = countBy(inside.map((p) => p.point));
      const responses = calls.filter((c) => c.end !== null && c.end >= press.start && c.end <= end);
      lines.push(`- press #${press.index} at ${rel(press.start)}: ${press.blockedMs}ms; probes ${fmtCounts(counts)}; responses landed: ${countByText(responses.map((c) => c.op))}`);
    }
  }
  lines.push("");

  lines.push("## Long tasks (>50ms) during and after the hold");
  const relevant = longTasks.filter((t) => t.start + t.duration >= holdStart);
  if (relevant.length === 0) lines.push("none");
  for (const task of relevant) {
    const end = task.start + task.duration;
    const inside = probes.filter((p) => p.t >= task.start && p.t <= end);
    const responses = calls.filter((c) => c.end !== null && c.end >= task.start - 5 && c.end <= end);
    lines.push(`- ${rel(task.start)} for ${task.duration.toFixed(0)}ms; probes ${fmtCounts(countBy(inside.map((p) => p.point)))}; responses in window: ${countByText(responses.map((c) => c.op))}`);
  }
  lines.push("");

  lines.push("## GraphQL round-trips issued during the hold and until idle");
  const byOp = new Map<string, GraphqlCall[]>();
  for (const call of calls) {
    if (!byOp.has(call.op)) byOp.set(call.op, []);
    byOp.get(call.op)!.push(call);
  }
  lines.push("| operation | count | p50 ms | p95 ms | max ms | sum ms | still open |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const [op, list] of [...byOp.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const done = list.filter((c) => c.end !== null).map((c) => c.end! - c.start);
    const s = stats(done);
    lines.push(`| ${op} | ${list.length} | ${s.p50} | ${s.p95} | ${s.max} | ${s.sum} | ${list.length - done.length} |`);
  }
  const concurrent = maxConcurrent(calls);
  lines.push("");
  lines.push(`Peak in-flight GraphQL requests: ${concurrent}. Requests per press: ${(calls.length / Math.max(1, presses.length)).toFixed(1)}.`);
  lines.push("");

  lines.push("## Probe points (count during hold / after hold)");
  const during = countBy(probes.filter((p) => p.t >= holdStart && p.t <= holdEnd).map((p) => p.point));
  const after = countBy(probes.filter((p) => p.t > holdEnd).map((p) => p.point));
  for (const point of new Set([...during.keys(), ...after.keys()])) {
    lines.push(`- ${point}: ${during.get(point) ?? 0} / ${after.get(point) ?? 0}`);
  }
  lines.push("");

  lines.push("## Selection lag");
  const selectProbes = probes.filter((p) => p.point === "store:select-task" && p.t >= holdStart);
  const keydownProbes = probes.filter((p) => p.point === "keydown:tasks.move" && p.t >= holdStart);
  lines.push(`keydowns routed: ${keydownProbes.length}, store writes: ${selectProbes.length}, presses sent: ${presses.length}.`);
  const lastRefresh = probes.filter((p) => p.point === "doc-registry-refresh:end").at(-1);
  if (lastRefresh) lines.push(`last doc-registry refresh finished at ${rel(lastRefresh.t)}.`);

  return {
    text: lines.join("\n"),
    raw: { firstName, lastName, selectedNow, presses, holdStart, holdEnd, selectedAt, detailsAt, idleAt, probes, longTasks, calls },
  };
}

function countBy(values: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of values) out.set(v, (out.get(v) ?? 0) + 1);
  return out;
}
function fmtCounts(counts: Map<string, number>): string {
  if (counts.size === 0) return "none";
  return [...counts.entries()].map(([k, v]) => `${k}×${v}`).join(", ");
}
function countByText(values: string[]): string {
  return fmtCounts(countBy(values));
}
function maxConcurrent(calls: GraphqlCall[]): number {
  const events: Array<[number, number]> = [];
  for (const c of calls) {
    events.push([c.start, 1]);
    events.push([c.end ?? Number.MAX_SAFE_INTEGER, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0, peak = 0;
  for (const [, d] of events) { cur += d; peak = Math.max(peak, cur); }
  return peak;
}
