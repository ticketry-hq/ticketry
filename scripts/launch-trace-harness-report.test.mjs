import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// Every seam here is the shipped one: the frontend records through Studio's own
// recorder, its lines reach the development log through the harness capture the
// desktop development run uses, the backend half is appended in the exact shape
// the Rust file log writes, and the report is built by the reader behind
// `npm run logs:trace`.
import { createLaunchDiscoveryRecorder } from "../studio/src/features/agents/status/launchDiscoveryTrace.ts";
import { createDevelopmentLogCapture } from "./dev-log-capture.mjs";
import { recentLogLines } from "./dev-logs.mjs";
import {
  buildLaunchTraceReport,
  parseLaunchTraceRecords,
  renderLaunchTraceReport,
} from "./launch-trace-report.mjs";

const projectId = "345113f3-2578-4285-aed7-b86eb7c4fd78";
const unhyphenatedProjectId = projectId.replaceAll("-", "");
const workItemId = "8534e827-585f-49cc-b51d-5b943d9cfb18";
const wakeupAuthority = "authority-1380";

/**
 * One launch driven through the harness. The clock is injected so the reported
 * elapsed times are the ones the launch produced rather than the ones the test
 * machine happened to take: this Story reports timings and asserts no latency
 * budget.
 */
function launchHarness(logPath, startedAt = "2026-08-31T08:30:00.000Z") {
  const base = Date.parse(startedAt);
  const at = () => new Date(base + offsetMs).toISOString();
  const discard = { write: () => true };
  let offsetMs = 0;
  const capture = createDevelopmentLogCapture({
    logPath,
    stdout: discard,
    stderr: discard,
    now: () => new Date(base + offsetMs),
  });
  const recorder = createLaunchDiscoveryRecorder({
    rendererInstance: "renderer-1380",
    runtimeInstance: "runtime-1380",
    now: at,
    write: (label, record) =>
      capture.write(
        "frontend",
        "stdout",
        `[frontend][info] ${label} ${JSON.stringify(record)}\n`,
      ),
  });

  return {
    backend(advanceMs, event, details) {
      offsetMs += advanceMs;
      const record = { event, timestamp: at(), projectId, ...details };
      appendFileSync(
        logPath,
        `${at()} [backend][info] launch-discovery ${JSON.stringify(record)}\n`,
      );
    },
    close: () => capture.close(),
    frontend(advanceMs, emit) {
      offsetMs += advanceMs;
      emit(recorder);
    },
  };
}

function reportFor(logPath, traceIdentity) {
  return buildLaunchTraceReport(
    parseLaunchTraceRecords(
      recentLogLines({ logPath, limit: Infinity }),
      traceIdentity,
    ),
  );
}

function developmentLogDirectory() {
  return mkdtempSync(path.join(tmpdir(), "ticketry-launch-trace-"));
}

/** A launch that reaches the workspace, both halves of it. */
function driveCompletedLaunch(
  logPath,
  {
    providerSlug,
    attemptId,
    agentRunId,
    cursor = 42,
    startedAt = "2026-08-31T08:30:00.000Z",
  },
) {
  const harness = launchHarness(logPath, startedAt);
  harness.backend(0, "launch-requested", {
    launchAttemptId: attemptId,
    agentRunId: null,
    launchSurface: "run-now",
    requestedProviderSlug: providerSlug,
    requestedModel: null,
    requestedReasoningLevel: null,
    requestedScope: "task",
    workItemId,
  });
  harness.backend(40, "launch-transaction-committed", {
    launchAttemptId: attemptId,
    agentRunId,
    cursor,
    workItemId,
    wakeupAuthority,
  });
  harness.backend(5, "wake-up-published", { agentRunId, cursor, wakeupAuthority });
  // The wake-up and the delivered frame reach the log with no Agent Run
  // identity, exactly as the runtime writes them.
  harness.backend(5, "wake-up-received", {
    projectId: unhyphenatedProjectId,
    agentRunId: null,
    cursor: cursor - 1,
    deliveryPath: "wake_up",
    wakeupAuthority,
  });
  harness.backend(10, "durable-event-reread", {
    agentRunId,
    cursor,
    deliveryPath: "wake_up",
    wakeupAuthority,
  });
  harness.backend(10, "graphql-frame-delivered", {
    projectId: unhyphenatedProjectId,
    agentRunId: null,
    cursor,
    frameKind: "snapshot",
  });

  const identity = { projectId, agentRunId, cursor, connectionGeneration: 1 };
  harness.frontend(25, (recorder) =>
    recorder.record("graphql-frame-received", identity, {
      frameType: "snapshot",
    }),
  );
  harness.frontend(15, (recorder) =>
    recorder.record("apollo-run-applied", identity, { source: "snapshot" }),
  );
  harness.frontend(40, (recorder) =>
    recorder.recordForAgentRun(
      "workspace-render-committed",
      projectId,
      agentRunId,
      { bucket: "task", moduleId: null, sessionId: "session-1380" },
    ),
  );
  harness.close();
}

for (const providerSlug of ["claude", "codex"]) {
  test(`reports one timed ${providerSlug} launch from request through workspace render`, () => {
    const directory = developmentLogDirectory();
    const logPath = path.join(directory, "ticketry.log");
    const attemptId = `attempt-${providerSlug}`;
    const agentRunId = `run-${providerSlug}`;

    driveCompletedLaunch(logPath, { providerSlug, attemptId, agentRunId });

    const report = reportFor(logPath, agentRunId);

    assert.deepEqual(
      report.stages.map(({ name }) => name),
      [
        "launch-requested",
        "launch-transaction-committed",
        "wake-up-published",
        "wake-up-received",
        "durable-event-reread",
        "graphql-frame-delivered",
        "graphql-frame-received",
        "apollo-run-applied",
        "workspace-render-committed",
      ],
    );
    assert.equal(report.lastStage, "workspace-render-committed");
    assert.deepEqual(report.outcome, { status: "completed" });
    // Elapsed time is carried for every stage, including the one that crosses
    // the process boundary from the backend half into the frontend half.
    assert.deepEqual(
      report.stages.map(({ elapsedMs }) => elapsedMs),
      [null, 40, 5, 5, 10, 10, 25, 15, 40],
    );
    assert.equal(report.providerSlug, providerSlug);
    assert.deepEqual(
      report.stages.map(({ providerSlug: stageProvider }) => stageProvider),
      report.stages.map(() => providerSlug),
    );
    // The launch attempt and the Agent Run it produced are one report, not two.
    assert.deepEqual(reportFor(logPath, attemptId), report);

    const rendered = renderLaunchTraceReport(agentRunId, report, {
      label: "Launch trace",
    });
    assert.match(rendered, new RegExp(`^Provider: ${providerSlug}$`, "m"));
    assert.match(rendered, /^Last stage: workspace-render-committed$/m);
    assert.equal(
      rendered.includes(
        `7. graphql-frame-received | ${providerSlug} | 2026-08-31T08:30:00.095Z | +25 ms`,
      ),
      true,
      rendered,
    );

    rmSync(directory, { recursive: true });
  });
}

test("names the pre-commit stage a launch was made to fail at", () => {
  const directory = developmentLogDirectory();
  const logPath = path.join(directory, "ticketry.log");
  const attemptId = "attempt-refused";
  const reason = {
    code: "executable_not_available",
    detail: "The approved claude executable is no longer present.",
  };
  const harness = launchHarness(logPath);

  harness.backend(0, "launch-requested", {
    launchAttemptId: attemptId,
    agentRunId: null,
    launchSurface: "studio-launch-picker",
    requestedProviderSlug: "claude",
    requestedModel: null,
    requestedReasoningLevel: null,
    requestedScope: "task",
    workItemId,
  });
  harness.backend(15, "launch-policy-evaluated", {
    launchAttemptId: attemptId,
    agentRunId: null,
    providerSlug: "claude",
    outcome: "admitted",
  });
  harness.backend(120, "executable-resolved", {
    launchAttemptId: attemptId,
    agentRunId: null,
    providerSlug: "claude",
    outcome: "refused",
    reason,
  });
  harness.close();

  const report = reportFor(logPath, attemptId);

  assert.deepEqual(
    report.stages.map(({ name }) => name),
    ["launch-requested", "launch-policy-evaluated", "executable-resolved"],
  );
  assert.equal(report.lastStage, "executable-resolved");
  assert.deepEqual(report.outcome, { status: "refused", reason });
  assert.deepEqual(
    report.stages.map(({ elapsedMs }) => elapsedMs),
    [null, 15, 120],
  );
  assert.deepEqual(
    report.stages.map(({ providerSlug }) => providerSlug),
    ["claude", "claude", "claude"],
  );
  const rendered = renderLaunchTraceReport(attemptId, report, {
    label: "Launch trace",
  });
  assert.equal(
    rendered.includes(`Refusal: ${JSON.stringify(reason)}`),
    true,
    rendered,
  );

  rmSync(directory, { recursive: true });
});

test("keeps two launches in the same development log as two reports", () => {
  const directory = developmentLogDirectory();
  const logPath = path.join(directory, "ticketry.log");

  driveCompletedLaunch(logPath, {
    providerSlug: "claude",
    attemptId: "attempt-first",
    agentRunId: "run-first",
    cursor: 42,
    startedAt: "2026-08-31T08:30:00.000Z",
  });
  driveCompletedLaunch(logPath, {
    providerSlug: "codex",
    attemptId: "attempt-second",
    agentRunId: "run-second",
    cursor: 43,
    startedAt: "2026-08-31T08:31:00.000Z",
  });

  for (const [traceIdentity, providerSlug] of [
    ["run-first", "claude"],
    ["run-second", "codex"],
  ]) {
    const report = reportFor(logPath, traceIdentity);
    assert.equal(report.providerSlug, providerSlug);
    assert.equal(report.stages.length, 9);
    assert.deepEqual(report.outcome, { status: "completed" });
  }

  rmSync(directory, { recursive: true });
});
