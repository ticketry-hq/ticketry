import type { ApolloClient, TypedDocumentNode } from "@apollo/client";

export const INSPECTION_PAGE_SIZE = 100;
interface Connection<Node> {
  nodes: Node[];
  pageInfo: { hasNextPage: boolean };
  paginationInfo?: { total: number } | null;
}
interface Variables { projectId: string; moduleId: string; offset: number; limit: number }

/** Normalize only a validated complete collection, while the requesting scope is current. */
export async function readInspectionCollection<Node extends { id: string }, Data extends Record<string, Connection<Node>>>(
  client: ApolloClient, query: TypedDocumentNode<Data, Variables>, field: keyof Data,
  variables: Variables, accepts: (node: Node) => boolean, isCurrent: () => boolean,
  reconcile: (node: Node) => Node = (node) => node,
): Promise<void> {
  const nodes: Node[] = []; const seen = new Set<string>(); let total: number | undefined;
  while (isCurrent()) {
    const result = await client.query({ query, variables: { ...variables, offset: nodes.length },
      fetchPolicy: "no-cache", context: { queryDeduplication: false } });
    if (!isCurrent()) return;
    const page = result.data?.[field] as Connection<Node> | undefined;
    const count = page?.paginationInfo?.total;
    if (!page || !Array.isArray(page.nodes) || page.nodes.length > variables.limit
      || typeof page.pageInfo?.hasNextPage !== "boolean" || typeof count !== "number"
      || !Number.isInteger(count) || count < 0 || (total !== undefined && total !== count)
      || page.nodes.some((node) => !accepts(node) || seen.has(node.id))) {
      throw new Error("Module inspection is incomplete. Retry to load authoritative metadata.");
    }
    total = count;
    for (const node of page.nodes) { if (seen.has(node.id)) throw new Error("Module inspection changed while loading. Retry."); seen.add(node.id); nodes.push(node); }
    if (page.pageInfo.hasNextPage) {
      if (!page.nodes.length || nodes.length >= count) throw new Error("Module inspection pagination is incomplete. Retry.");
      continue;
    }
    if (nodes.length !== count) throw new Error("Module inspection pagination is incomplete. Retry.");
    if (isCurrent()) {
      client.writeQuery({ query, variables, data: { ...result.data, [field]: { ...page, nodes: nodes.map(reconcile) } } as Data });
      if (!client.cache.diff({ query, variables, returnPartialData: true, optimistic: false }).complete) {
        throw new Error("Module inspection fields are unavailable. Retry to load authoritative metadata.");
      }
    }
    return;
  }
}
