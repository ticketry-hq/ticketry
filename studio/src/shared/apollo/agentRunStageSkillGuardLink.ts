import { ApolloLink, gql, type ApolloCache, type InMemoryCache } from "@apollo/client";
import { Kind, visit, type DocumentNode, type FieldNode } from "graphql";
import { map } from "rxjs";

type JsonObject = Record<string, unknown>;
const observationFragment = gql`
  fragment StageSkillObservation on AgentRuns {
    stageSkillAvailability
    stageSkillObservationGeneration @client
  }
`;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The report stays in Apollo; only its observation counter orders pending reads. */
export function stageSkillObservationGeneration(cache: ApolloCache, runId: string): number {
  const id = cache.identify({ __typename: "AgentRuns", id: runId });
  if (!id) return 0;
  return cache.readFragment<{ stageSkillObservationGeneration?: number }>({
    id, fragment: observationFragment, returnPartialData: true, optimistic: false,
  })?.stageSkillObservationGeneration ?? 0;
}

function reportSelections(query: DocumentNode): { idKey: string; reportKey: string }[] {
  const selections: { idKey: string; reportKey: string }[] = [];
  visit(query, {
    SelectionSet(node) {
      const fields = node.selections.filter((selection): selection is FieldNode => selection.kind === Kind.FIELD);
      const id = fields.find((field) => field.name.value === "id");
      const report = fields.find((field) => field.name.value === "stageSkillAvailability");
      if (id && report) selections.push({
        idKey: id.alias?.value ?? id.name.value,
        reportKey: report.alias?.value ?? report.name.value,
      });
    },
  });
  return selections;
}

function guardReports(
  value: unknown,
  cache: InMemoryCache,
  selections: ReturnType<typeof reportSelections>,
  initialGenerations: ReadonlyMap<string, number>,
): unknown {
  if (Array.isArray(value)) return value.map((child) => guardReports(child, cache, selections, initialGenerations));
  if (!isObject(value)) return value;
  const children = Object.fromEntries(Object.entries(value).map(([key, child]) =>
    [key, guardReports(child, cache, selections, initialGenerations)],
  ));
  if (value.__typename !== "AgentRuns") return children;
  for (const { idKey, reportKey } of selections) {
    if (typeof value[idKey] !== "string" || !(reportKey in value)) continue;
    const id = cache.identify({ __typename: "AgentRuns", id: value[idKey] });
    if (!id) continue;
    const cached = cache.readFragment<{
      stageSkillAvailability?: string | null;
      stageSkillObservationGeneration?: number;
    }>({ id, fragment: observationFragment, returnPartialData: true, optimistic: false });
    if (cached && (cached.stageSkillObservationGeneration ?? 0) > (initialGenerations.get(id) ?? 0)
      && cached.stageSkillAvailability !== undefined) {
      // Null is an authoritative clearing, just as a non-null report is a warning.
      children[reportKey] = cached.stageSkillAvailability;
    }
  }
  return children;
}

/** Preserve lifecycle observations made after a run read started, across all read aliases. */
export function createAgentRunStageSkillGuardLink(cache: InMemoryCache): ApolloLink {
  return new ApolloLink((operation, forward) => {
    const selections = reportSelections(operation.query);
    if (!selections.length || operation.operationType !== "query") return forward(operation);
    const initialGenerations = new Map(Object.entries(cache.extract(false)).flatMap(([id, row]) =>
      isObject(row) && row.__typename === "AgentRuns"
        ? [[id, typeof row.stageSkillObservationGeneration === "number" ? row.stageSkillObservationGeneration : 0] as const]
        : [],
    ));
    return forward(operation).pipe(map((result) => result.data === undefined ? result : {
      ...result,
      data: guardReports(result.data, cache, selections, initialGenerations) as typeof result.data,
    }));
  });
}
