import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLaunchTraceReport,
  parseLaunchTraceRecords,
  renderLaunchTraceReport,
} from "./launch-trace-report.mjs";

test("extracts one Agent Run from backend and frontend development-log lines", () => {
  const records = parseLaunchTraceRecords(
    [
      '2026-08-31T08:30:00.100Z [backend][info] launch-discovery {"event":"launch-transaction-committed","timestamp":"2026-08-31T08:30:00.100Z","agentRunId":"run-1373"}',
      '2026-08-31T08:30:00.120Z [frontend:stdout] [frontend][info] [launch-discovery] {"event":"apollo-run-applied","timestamp":"2026-08-31T08:30:00.119Z","agentRunId":"run-1373"}',
      '2026-08-31T08:30:00.130Z [frontend:stdout] [frontend][info] [launch-discovery] {"event":"apollo-run-applied","timestamp":"2026-08-31T08:30:00.129Z","agentRunId":"another-run"}',
      "2026-08-31T08:30:00.140Z [backend][info] launch-discovery not-json",
      '2026-08-31T08:30:00.145Z [backend][info] launch-discovery {"timestamp":"2026-08-31T08:30:00.145Z","agentRunId":"run-1373"}',
      '2026-08-31T08:30:00.147Z [backend][info] launch-discovery {"event":"wake-up-published","timestamp":"not-a-time","agentRunId":"run-1373"}',
      "2026-08-31T08:30:00.150Z [backend][info] unrelated {}",
    ],
    "run-1373",
  );

  assert.deepEqual(
    records.map(({ event }) => event),
    ["launch-transaction-committed", "apollo-run-applied"],
  );
});

test("joins attempt-keyed request records to the Agent Run produced at commit", () => {
  const lines = [
    '2026-08-31T08:30:00.080Z [backend][info] launch-discovery {"event":"launch-requested","timestamp":"2026-08-31T08:30:00.080Z","launchAttemptId":"attempt-1374","agentRunId":null,"launchSurface":"run-now"}',
    '2026-08-31T08:30:00.100Z [backend][info] launch-discovery {"event":"launch-transaction-committed","timestamp":"2026-08-31T08:30:00.100Z","launchAttemptId":"attempt-1374","agentRunId":"run-1374"}',
    '2026-08-31T08:30:00.150Z [frontend:stdout] [frontend][info] [launch-discovery] {"event":"workspace-render-committed","timestamp":"2026-08-31T08:30:00.150Z","launchAttemptId":null,"agentRunId":"run-1374"}',
  ];

  for (const identity of ["attempt-1374", "run-1374"]) {
    assert.deepEqual(
      parseLaunchTraceRecords(lines, identity).map(({ event }) => event),
      [
        "launch-requested",
        "launch-transaction-committed",
        "workspace-render-committed",
      ],
    );
  }
});

test("returns an attempt-keyed trace that never reached commit", () => {
  const records = parseLaunchTraceRecords(
    [
      '2026-08-31T08:30:00.080Z [backend][info] launch-discovery {"event":"launch-requested","timestamp":"2026-08-31T08:30:00.080Z","launchAttemptId":"attempt-stopped","agentRunId":null,"launchSurface":"workflow-auto-start"}',
      '2026-08-31T08:30:00.090Z [backend][info] launch-discovery {"event":"launch-policy-evaluated","timestamp":"2026-08-31T08:30:00.090Z","launchAttemptId":"attempt-stopped","agentRunId":null,"outcome":"refused","reason":{"code":"binding_not_configured"}}',
    ],
    "attempt-stopped",
  );

  assert.deepEqual(
    records.map(({ event }) => event),
    ["launch-requested", "launch-policy-evaluated"],
  );
  assert.deepEqual(buildLaunchTraceReport(records).outcome, {
    status: "refused",
    reason: { code: "binding_not_configured" },
  });
});

test("correlates a null-identity wake-up through its durable reread", () => {
  const records = parseLaunchTraceRecords(
    [
      '2026-08-31T08:30:00.100Z [backend][info] launch-discovery {"event":"wake-up-published","timestamp":"2026-08-31T08:30:00.100Z","projectId":"345113f325784285aed7b86eb7c4fd78","agentRunId":"run-1373","cursor":42,"wakeupAuthority":"runtime-1"}',
      '2026-08-31T08:30:00.110Z [backend][info] launch-discovery {"event":"wake-up-received","timestamp":"2026-08-31T08:30:00.110Z","projectId":"345113f3-2578-4285-aed7-b86eb7c4fd78","agentRunId":null,"cursor":41,"deliveryPath":"wake_up","wakeupAuthority":"runtime-1"}',
      '2026-08-31T08:30:00.120Z [backend][info] launch-discovery {"event":"durable-event-reread","timestamp":"2026-08-31T08:30:00.120Z","projectId":"345113f3-2578-4285-aed7-b86eb7c4fd78","agentRunId":"run-1373","cursor":42,"deliveryPath":"wake_up","wakeupAuthority":"runtime-1"}',
    ],
    "run-1373",
  );

  assert.deepEqual(
    records.map(({ event, agentRunId }) => ({ event, agentRunId })),
    [
      { event: "wake-up-published", agentRunId: "run-1373" },
      { event: "wake-up-received", agentRunId: "run-1373" },
      { event: "durable-event-reread", agentRunId: "run-1373" },
    ],
  );
});

test("correlates a null-identity delivered frame through its received frame", () => {
  const records = parseLaunchTraceRecords(
    [
      '2026-08-31T08:30:00.130Z [backend][info] launch-discovery {"event":"graphql-frame-delivered","timestamp":"2026-08-31T08:30:00.130Z","projectId":"345113f325784285aed7b86eb7c4fd78","agentRunId":null,"cursor":42,"frameKind":"snapshot"}',
      '2026-08-31T08:30:00.140Z [frontend:stdout] [frontend][info] [launch-discovery] {"event":"graphql-frame-received","timestamp":"2026-08-31T08:30:00.140Z","projectId":"345113f3-2578-4285-aed7-b86eb7c4fd78","agentRunId":"run-1373","cursor":42,"frameType":"snapshot"}',
    ],
    "run-1373",
  );

  assert.deepEqual(
    records.map(({ event, agentRunId }) => ({ event, agentRunId })),
    [
      { event: "graphql-frame-delivered", agentRunId: "run-1373" },
      { event: "graphql-frame-received", agentRunId: "run-1373" },
    ],
  );
});

test("reports shuffled launch records in timed path order", () => {
  const report = buildLaunchTraceReport([
    {
      event: "graphql-frame-received",
      timestamp: "2026-08-31T08:30:00.190Z",
      agentRunId: "run-1373",
    },
    {
      event: "durable-event-reread",
      timestamp: "2026-08-31T08:30:00.160Z",
      agentRunId: "run-1373",
    },
    {
      event: "launch-transaction-committed",
      timestamp: "2026-08-31T08:30:00.170Z",
      agentRunId: "run-1373",
    },
  ]);

  assert.deepEqual(report.stages, [
    {
      name: "launch-transaction-committed",
      providerSlug: null,
      timestamp: "2026-08-31T08:30:00.170Z",
      elapsedMs: null,
    },
    {
      name: "durable-event-reread",
      providerSlug: null,
      timestamp: "2026-08-31T08:30:00.160Z",
      elapsedMs: -10,
    },
    {
      name: "graphql-frame-received",
      providerSlug: null,
      timestamp: "2026-08-31T08:30:00.190Z",
      elapsedMs: 30,
    },
  ]);
  assert.equal(report.lastStage, "graphql-frame-received");
  assert.deepEqual(report.outcome, { status: "incomplete" });
  assert.match(
    renderLaunchTraceReport("run-1373", report),
    /durable-event-reread .* \| -10 ms/,
  );
});

test("reports a repeated stage once and preserves a terminal refusal", () => {
  const reason = { code: "delivery_refused" };
  const records = [
    {
      event: "graphql-frame-received",
      timestamp: "2026-08-31T08:30:00.190Z",
      agentRunId: "run-1373",
    },
    {
      event: "graphql-frame-received",
      timestamp: "2026-08-31T08:31:00.190Z",
      agentRunId: "run-1373",
    },
    {
      event: "graphql-frame-received",
      timestamp: "2026-08-31T08:31:00.190Z",
      agentRunId: "run-1373",
      outcome: "refused",
      reason,
    },
  ];
  const report = buildLaunchTraceReport(records);

  assert.deepEqual(report.stages, [
    {
      name: "graphql-frame-received",
      providerSlug: null,
      timestamp: "2026-08-31T08:31:00.190Z",
      elapsedMs: null,
    },
  ]);
  assert.deepEqual(report.outcome, { status: "refused", reason });
  assert.deepEqual(buildLaunchTraceReport(records.toReversed()), report);
});

test("chooses repeated records that form one monotonic path when possible", () => {
  const report = buildLaunchTraceReport([
    {
      event: "graphql-frame-received",
      timestamp: "2026-08-31T08:30:00.100Z",
      agentRunId: "run-1373",
    },
    {
      event: "graphql-frame-delivered",
      timestamp: "2026-08-31T08:30:00.130Z",
      agentRunId: "run-1373",
    },
    {
      event: "graphql-frame-received",
      timestamp: "2026-08-31T08:30:00.140Z",
      agentRunId: "run-1373",
    },
  ]);

  assert.deepEqual(
    report.stages.map(({ name, timestamp }) => ({ name, timestamp })),
    [
      {
        name: "graphql-frame-delivered",
        timestamp: "2026-08-31T08:30:00.130Z",
      },
      {
        name: "graphql-frame-received",
        timestamp: "2026-08-31T08:30:00.140Z",
      },
    ],
  );
});

test("treats the Apollo run and event variants as one path stage", () => {
  const report = buildLaunchTraceReport([
    {
      event: "apollo-event-applied",
      timestamp: "2026-08-31T08:30:00.200Z",
      agentRunId: "run-1373",
    },
    {
      event: "apollo-run-applied",
      timestamp: "2026-08-31T08:30:00.210Z",
      agentRunId: "run-1373",
    },
  ]);

  assert.equal(report.stages.length, 1);
  assert.equal(report.stages[0].name, "apollo-event-applied");
});

test("classifies a trace through workspace render as completed", () => {
  const report = buildLaunchTraceReport([
    {
      event: "launch-transaction-committed",
      timestamp: "2026-08-31T08:30:00.100Z",
      agentRunId: "run-1373",
    },
    {
      event: "workspace-render-committed",
      timestamp: "2026-08-31T08:30:00.400Z",
      agentRunId: "run-1373",
    },
  ]);

  assert.equal(report.lastStage, "workspace-render-committed");
  assert.deepEqual(report.outcome, { status: "completed" });
});

test("carries the last stage structured refusal reason", () => {
  const reason = {
    code: "provider_not_registered",
    detail: "Provider claude is not registered",
  };
  const report = buildLaunchTraceReport([
    {
      event: "launch-requested",
      timestamp: "2026-08-31T08:30:00.100Z",
      agentRunId: "run-1373",
      outcome: "admitted",
    },
    {
      event: "provider-validated",
      timestamp: "2026-08-31T08:30:00.120Z",
      agentRunId: "run-1373",
      outcome: "refused",
      reason,
    },
  ]);

  assert.equal(report.lastStage, "provider-validated");
  assert.deepEqual(report.outcome, { status: "refused", reason });
  assert.match(
    renderLaunchTraceReport("run-1373", report),
    /Refusal: \{"code":"provider_not_registered","detail":"Provider claude is not registered"\}/,
  );
});

test("reports an unrecognised stage without mutating the records", () => {
  const records = Object.freeze([
    Object.freeze({
      event: "future-stage-added-by-another-ticket",
      timestamp: "2026-08-31T08:30:00.110Z",
      agentRunId: "run-1373",
    }),
    Object.freeze({
      event: "launch-transaction-committed",
      timestamp: "2026-08-31T08:30:00.100Z",
      agentRunId: "run-1373",
    }),
  ]);

  const report = buildLaunchTraceReport(records);

  assert.deepEqual(
    report.stages.map(({ name }) => name),
    ["launch-transaction-committed", "future-stage-added-by-another-ticket"],
  );
});

test("renders the timed report for a developer", () => {
  const report = buildLaunchTraceReport([
    {
      event: "launch-transaction-committed",
      timestamp: "2026-08-31T08:30:00.100Z",
      agentRunId: "run-1373",
    },
    {
      event: "graphql-frame-received",
      timestamp: "2026-08-31T08:30:00.145Z",
      agentRunId: "run-1373",
    },
  ]);

  assert.equal(
    renderLaunchTraceReport("run-1373", report),
    [
      "Agent Run: run-1373",
      "Provider: unknown",
      "Status: incomplete",
      "Last stage: graphql-frame-received",
      "Stages:",
      "1. launch-transaction-committed | unknown | 2026-08-31T08:30:00.100Z | start",
      "2. graphql-frame-received | unknown | 2026-08-31T08:30:00.145Z | +45 ms",
    ].join("\n"),
  );
});

test("carries the provider slug on every stage of the report", () => {
  const report = buildLaunchTraceReport([
    {
      event: "launch-requested",
      timestamp: "2026-08-31T08:30:00.100Z",
      launchAttemptId: "attempt-1380",
      agentRunId: null,
      requestedProviderSlug: "claude",
    },
    {
      event: "launch-transaction-committed",
      timestamp: "2026-08-31T08:30:00.140Z",
      launchAttemptId: "attempt-1380",
      agentRunId: "run-1380",
    },
    {
      event: "workspace-render-committed",
      timestamp: "2026-08-31T08:30:00.400Z",
      agentRunId: "run-1380",
    },
  ]);

  assert.equal(report.providerSlug, "claude");
  assert.deepEqual(
    report.stages.map(({ name, providerSlug }) => ({ name, providerSlug })),
    [
      { name: "launch-requested", providerSlug: "claude" },
      { name: "launch-transaction-committed", providerSlug: "claude" },
      { name: "workspace-render-committed", providerSlug: "claude" },
    ],
  );
  assert.match(renderLaunchTraceReport("run-1380", report), /Provider: claude/);
});

test("keeps a stage's own provider slug over the carried one", () => {
  const report = buildLaunchTraceReport([
    {
      event: "launch-requested",
      timestamp: "2026-08-31T08:30:00.100Z",
      agentRunId: null,
      requestedProviderSlug: "claude",
    },
    {
      event: "provider-validated",
      timestamp: "2026-08-31T08:30:00.110Z",
      agentRunId: null,
      providerSlug: "codex",
    },
  ]);

  assert.deepEqual(
    report.stages.map(({ providerSlug }) => providerSlug),
    ["claude", "codex"],
  );
});

test("orders the pre-commit stages ahead of the commit they precede", () => {
  const report = buildLaunchTraceReport(
    [
      "prompt-delivered",
      "launch-transaction-committed",
      "launch-policy-evaluated",
      "executable-resolved",
      "launch-requested",
    ].map((event, index) => ({
      event,
      timestamp: `2026-08-31T08:30:0${index}.000Z`,
      agentRunId: "run-1380",
    })),
  );

  assert.deepEqual(
    report.stages.map(({ name }) => name),
    [
      "launch-requested",
      "launch-policy-evaluated",
      "executable-resolved",
      "prompt-delivered",
      "launch-transaction-committed",
    ],
  );
});
