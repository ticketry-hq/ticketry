import { documentOperationName } from "../graphql-foundation/typedDocument";
import { compactWorktrackerId } from "../shared/api/generatedWorktracker";
import { fixture, workItem, type FixtureStorySprint, type HttpFixture } from "./seam";

export interface SprintPageRequest {
  filters: { projectId: { eq: string }; status: { eq: string }; name?: { contains: string } };
  pagination: { offset: { limit: number; offset: number } };
  order: { rank: string; id: string };
}

/** Public GraphQL transport fixture; never replaces a query hook or Apollo. */
export function storySprintPaginationBoundary() {
  const http = fixture();
  const rows: FixtureStorySprint[] = [
    { id: "active-sprint", projectId: "project-1", name: "Current cycle", status: "active", rank: "U", createdAt: "2026-01-01T00:00:00Z" },
    ...Array.from({ length: 14 }, (_, index) => ({ id: `planned-${String(index + 1).padStart(2, "0")}`, projectId: "project-1", name: `Planned ${String(index + 1).padStart(2, "0")}`, status: "planned", rank: `a${String(index + 1).padStart(2, "0")}`, createdAt: `2026-02-${String(index + 1).padStart(2, "0")}T00:00:00Z` })),
    ...Array.from({ length: 23 }, (_, index) => ({ id: `completed-${String(index + 1).padStart(2, "0")}`, projectId: "project-1", name: `Completed ${String(index + 1).padStart(2, "0")}`, status: "completed", rank: `A${String(index + 1).padStart(2, "0")}`, createdAt: `2026-03-${String(index + 1).padStart(2, "0")}T00:00:00Z` })),
    { id: "foreign-sprint", projectId: "project-2", name: "Planned foreign", status: "planned", rank: "a00", createdAt: "2025-01-01T00:00:00Z" },
  ];
  http.storySprints(rows);
  http.tree("module-1", { rootIds: ["story-1"], children: { "story-1": [] }, order: ["story-1"] });
  http.workItems([workItem({ sprint_id: "active-sprint" })]);
  const requests: SprintPageRequest[] = [];
  let beforePage: ((request: SprintPageRequest) => void | Promise<void>) | undefined;
  const execute: HttpFixture["executeGraphQl"] = async (document, variables) => {
    if (documentOperationName(document) !== "SprintChoicePage") return http.executeGraphQl(document, variables);
    const request = variables as SprintPageRequest;
    requests.push(request);
    await beforePage?.(request);
    const matches = rows.filter((row) => compactWorktrackerId(row.projectId) === compactWorktrackerId(request.filters.projectId.eq)
      && row.status === request.filters.status.eq && (!request.filters.name?.contains || row.name.toLowerCase().includes(request.filters.name?.contains.toLowerCase())))
      .sort((a, b) => {
        const left = a.rank ?? "";
        const right = b.rank ?? "";
        const compared = left < right ? -1 : left > right ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        return compared * (request.order.rank === "DESC" ? -1 : 1);
      });
    const nodes = matches.slice(request.pagination.offset.offset, request.pagination.offset.offset + request.pagination.offset.limit).map((row) => ({
      __typename: "WorktrackerSprint", ...row, id: compactWorktrackerId(row.id), projectId: compactWorktrackerId(row.projectId),
    }));
    return { sprints: { __typename: "WorktrackerSprintConnection", nodes,
      pageInfo: { __typename: "PageInfo", hasNextPage: request.pagination.offset.offset + nodes.length < matches.length },
      paginationInfo: { __typename: "PaginationInfo", total: matches.length } } } as never;
  };
  return { http, execute, requests, rows, beforePage: (handler: typeof beforePage) => { beforePage = handler; } };
}
