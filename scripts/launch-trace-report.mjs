const launchDiscoveryMarkers = ["[launch-discovery] ", "launch-discovery "];
const launchPath = Object.freeze([
  "launch-requested",
  "launch-policy-evaluated",
  "authority-resolved",
  "provider-validated",
  "executable-resolved",
  "working-directory-preflighted",
  "argv-materialised",
  "terminal-runtime-spawned",
  "prompt-delivered",
  "launch-transaction-committed",
  "wake-up-published",
  "wake-up-received",
  "durable-event-reread",
  "graphql-frame-delivered",
  "graphql-frame-received",
  "apollo-run-applied",
  "workspace-render-committed",
]);

function stageRank(event) {
  const stage = canonicalStage(event);
  const rank = launchPath.indexOf(stage);
  return rank === -1 ? Number.POSITIVE_INFINITY : rank;
}

function canonicalStage(event) {
  return event === "apollo-event-applied" ? "apollo-run-applied" : event;
}

/**
 * A stage names its provider through its own slug where it knows one. The
 * post-commit half cannot know it, so the trace's provider is carried forward
 * from the stage that established it.
 */
function recordProviderSlug(record) {
  for (const field of ["providerSlug", "requestedProviderSlug"]) {
    const value = record[field];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function isLaunchTraceRecord(record) {
  return (
    record !== null &&
    typeof record === "object" &&
    !Array.isArray(record) &&
    typeof record.event === "string" &&
    record.event.length > 0 &&
    typeof record.timestamp === "string" &&
    Number.isFinite(Date.parse(record.timestamp))
  );
}

function compareChronology(left, right) {
  const elapsed = Date.parse(left.timestamp) - Date.parse(right.timestamp);
  if (elapsed !== 0) return elapsed;
  const leftRank = stageRank(left.event);
  const rightRank = stageRank(right.event);
  if (leftRank !== rightRank) return leftRank - rightRank;
  if (left.outcome === "refused" && right.outcome !== "refused") return -1;
  if (right.outcome === "refused" && left.outcome !== "refused") return 1;
  return left.event.localeCompare(right.event);
}

function compareStageCandidates(left, right) {
  if (left.outcome === "refused" && right.outcome !== "refused") return -1;
  if (right.outcome === "refused" && left.outcome !== "refused") return 1;
  return compareChronology(left, right);
}

function selectStageRecord(records, notBefore = Number.NEGATIVE_INFINITY) {
  const refused = records.filter((record) => record.outcome === "refused");
  const candidates = (refused.length > 0 ? refused : records).toSorted(
    compareStageCandidates,
  );
  return (
    candidates.find((record) => Date.parse(record.timestamp) >= notBefore) ??
    candidates[0]
  );
}

function normalizedIdentity(value) {
  return typeof value === "string" ? value.replaceAll("-", "").toLowerCase() : null;
}

export function parseLaunchTraceRecords(lines, traceIdentity) {
  const records = lines.flatMap((line) => {
    const marker = launchDiscoveryMarkers.find((candidate) =>
      line.includes(candidate),
    );
    if (!marker) return [];
    const json = line.slice(line.indexOf(marker) + marker.length);
    try {
      const record = JSON.parse(json);
      return isLaunchTraceRecord(record) ? [record] : [];
    } catch {
      return [];
    }
  });
  const launchAttemptIds = new Set(
    records
      .filter((record) => record.launchAttemptId === traceIdentity)
      .map((record) => record.launchAttemptId),
  );
  const agentRunIds = new Set(
    records
      .filter((record) => record.agentRunId === traceIdentity)
      .map((record) => record.agentRunId),
  );
  let foundPair;
  do {
    foundPair = false;
    for (const record of records) {
      if (
        record.event !== "launch-transaction-committed" ||
        typeof record.launchAttemptId !== "string" ||
        typeof record.agentRunId !== "string" ||
        (!launchAttemptIds.has(record.launchAttemptId) &&
          !agentRunIds.has(record.agentRunId))
      ) {
        continue;
      }
      if (!launchAttemptIds.has(record.launchAttemptId)) {
        launchAttemptIds.add(record.launchAttemptId);
        foundPair = true;
      }
      if (!agentRunIds.has(record.agentRunId)) {
        agentRunIds.add(record.agentRunId);
        foundPair = true;
      }
    }
  } while (foundPair);
  const matched = records.filter(
    (record) =>
      launchAttemptIds.has(record.launchAttemptId) ||
      agentRunIds.has(record.agentRunId),
  );
  const correlated = new Map();
  for (const reread of matched) {
    if (
      reread.event !== "durable-event-reread" ||
      reread.deliveryPath !== "wake_up"
    ) {
      continue;
    }
    const projectId = normalizedIdentity(reread.projectId);
    if (!projectId || typeof reread.wakeupAuthority !== "string") continue;
    const received = records
      .filter(
        (record) =>
          record.event === "wake-up-received" &&
          record.agentRunId === null &&
          normalizedIdentity(record.projectId) === projectId &&
          record.wakeupAuthority === reread.wakeupAuthority &&
          Date.parse(record.timestamp) <= Date.parse(reread.timestamp),
      )
      .toSorted(compareChronology)
      .at(-1);
    if (received) correlated.set(received, reread.agentRunId);
  }
  for (const received of matched) {
    if (received.event !== "graphql-frame-received") continue;
    const projectId = normalizedIdentity(received.projectId);
    if (
      !projectId ||
      received.cursor === null ||
      received.cursor === undefined ||
      typeof received.frameType !== "string"
    ) {
      continue;
    }
    const delivered = records
      .filter(
        (record) =>
          record.event === "graphql-frame-delivered" &&
          record.agentRunId === null &&
          normalizedIdentity(record.projectId) === projectId &&
          record.cursor === received.cursor &&
          record.frameKind === received.frameType &&
          Date.parse(record.timestamp) <= Date.parse(received.timestamp),
      )
      .toSorted(compareChronology)
      .at(-1);
    if (delivered) correlated.set(delivered, received.agentRunId);
  }
  return [
    ...matched,
    ...[...correlated].map(([record, correlatedAgentRunId]) => ({
      ...record,
      agentRunId: correlatedAgentRunId,
    })),
  ].toSorted(compareChronology);
}

/**
 * Pure record-to-report transformation. A refusing stage records
 * `outcome: "refused"` and carries its structured `reason` unchanged.
 */
export function buildLaunchTraceReport(records) {
  const byStage = new Map();
  for (const record of records.filter(isLaunchTraceRecord)) {
    const key = canonicalStage(record.event);
    const stageRecords = byStage.get(key) ?? [];
    stageRecords.push(record);
    byStage.set(key, stageRecords);
  }
  const known = [];
  let notBefore = Number.NEGATIVE_INFINITY;
  for (const stage of launchPath) {
    const stageRecords = byStage.get(stage);
    if (!stageRecords) continue;
    const selected = selectStageRecord(stageRecords, notBefore);
    known.push(selected);
    notBefore = Date.parse(selected.timestamp);
    byStage.delete(stage);
  }
  const unknown = [...byStage.values()]
    .map((stageRecords) => selectStageRecord(stageRecords))
    .toSorted(compareChronology);
  const unknownBefore = Array.from({ length: known.length + 1 }, () => []);
  for (const record of unknown) {
    const insertion = known.findIndex(
      (knownRecord) =>
        Date.parse(knownRecord.timestamp) > Date.parse(record.timestamp),
    );
    unknownBefore[insertion === -1 ? known.length : insertion].push(record);
  }
  const ordered = known.flatMap((record, index) => [
    ...unknownBefore[index],
    record,
  ]);
  ordered.push(...unknownBefore.at(-1));
  const traceProviderSlug =
    ordered.map(recordProviderSlug).find((slug) => slug !== null) ?? null;
  const stages = ordered.map((record, index) => ({
    name: record.event,
    providerSlug: recordProviderSlug(record) ?? traceProviderSlug,
    timestamp: record.timestamp,
    elapsedMs:
      index === 0
        ? null
        : Date.parse(record.timestamp) - Date.parse(ordered[index - 1].timestamp),
  }));
  const lastRecord = ordered.at(-1);
  const lastStage = stages.at(-1)?.name ?? null;
  const outcome =
    lastRecord?.outcome === "refused"
      ? { status: "refused", reason: lastRecord.reason }
      : {
          status:
            known.some(
              (record) =>
                canonicalStage(record.event) === "workspace-render-committed",
            )
              ? "completed"
              : "incomplete",
        };

  return {
    providerSlug: traceProviderSlug,
    stages,
    lastStage,
    outcome,
  };
}

export function renderLaunchTraceReport(
  identity,
  report,
  { label = "Agent Run" } = {},
) {
  const lines = [
    `${label}: ${identity}`,
    `Provider: ${report.providerSlug ?? "unknown"}`,
    `Status: ${report.outcome.status}`,
  ];
  if (report.outcome.status === "refused") {
    lines.push(`Refusal: ${JSON.stringify(report.outcome.reason)}`);
  }
  lines.push(`Last stage: ${report.lastStage ?? "none"}`, "Stages:");
  report.stages.forEach((stage, index) => {
    const elapsed =
      stage.elapsedMs === null
        ? "start"
        : `${stage.elapsedMs >= 0 ? "+" : ""}${stage.elapsedMs} ms`;
    lines.push(
      `${index + 1}. ${stage.name} | ${stage.providerSlug ?? "unknown"} | ` +
        `${stage.timestamp} | ${elapsed}`,
    );
  });
  return lines.join("\n");
}
