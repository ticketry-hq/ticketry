interface CacheEntry {
  queryKey: readonly unknown[];
  state: { data: unknown };
}

type RunProjection = Record<string, object>;

export interface DuplicateWorkItemHolding {
  id: string;
  queryKeys: string[];
}

export interface RunFieldOverlap {
  runId: string;
  queryKey: string;
  fields: string[];
}

function collectionAwareReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Set) return [...value];
  if (value instanceof Map) return Object.fromEntries(value);
  return value;
}

export function serializeWithCollections(value: unknown): string {
  return JSON.stringify(value, collectionAwareReplacer);
}

function visitObjects(
  value: unknown,
  visit: (record: Record<string, unknown>) => void,
  seen = new Set<object>(),
): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);

  if (value instanceof Map) {
    for (const [key, entry] of value) {
      visitObjects(key, visit, seen);
      visitObjects(entry, visit, seen);
    }
    return;
  }
  if (value instanceof Set) {
    for (const entry of value) visitObjects(entry, visit, seen);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) visitObjects(entry, visit, seen);
    return;
  }

  const record = value as Record<string, unknown>;
  visit(record);
  for (const entry of Object.values(record)) visitObjects(entry, visit, seen);
}

function isWorkItemRecord(record: Record<string, unknown>): record is Record<string, unknown> & { id: string } {
  return (
    typeof record.id === "string" &&
    typeof record.project_id === "string" &&
    typeof record.sequence_id === "number" &&
    typeof record.name === "string" &&
    typeof record.key === "string" &&
    "issue_type" in record &&
    Array.isArray(record.blocked_by_ids) &&
    Array.isArray(record.blocks_ids)
  );
}

export function findDuplicateWorkItemHoldings(
  entries: readonly CacheEntry[],
): DuplicateWorkItemHolding[] {
  const keysById = new Map<string, string[]>();
  for (const entry of entries) {
    const idsInEntry = new Set<string>();
    visitObjects(entry.state.data, (record) => {
      if (isWorkItemRecord(record)) idsInEntry.add(record.id);
    });
    const queryKey = serializeWithCollections(entry.queryKey);
    for (const id of idsInEntry) {
      keysById.set(id, [...(keysById.get(id) ?? []), queryKey]);
    }
  }
  return [...keysById.entries()]
    .filter(([, queryKeys]) => queryKeys.length > 1)
    .map(([id, queryKeys]) => ({ id, queryKeys }));
}

export function findRunFieldOverlaps(
  entries: readonly CacheEntry[],
  projection: RunProjection,
): RunFieldOverlap[] {
  const overlaps: RunFieldOverlap[] = [];
  for (const entry of entries) {
    visitObjects(entry.state.data, (record) => {
      const runId = record.agent_run_id;
      if (typeof runId !== "string") return;
      const projected = projection[runId];
      if (!projected) return;
      const fields = Object.keys(record)
        .filter((field) => field !== "agent_run_id" && field in projected)
        .sort();
      if (fields.length > 0) {
        overlaps.push({
          runId,
          queryKey: serializeWithCollections(entry.queryKey),
          fields,
        });
      }
    });
  }
  return overlaps;
}
