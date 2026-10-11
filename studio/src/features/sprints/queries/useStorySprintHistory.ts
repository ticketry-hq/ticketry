import { skipToken, useQuery } from "@apollo/client/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { compactWorktrackerId, publicWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../../shared/apollo/client";
import { SprintChoicePageDocument, type SprintChoicePageQueryVariables, type SprintChoiceFieldsFragment } from "../generated/storySprintChoices.documents";
import { subscribeSprintChoicesRefresh } from "./refreshSprintChoices";
import { emptyMetadata, invalidateSprintHistory, usePageMetadata, writeMetadata } from "./sprintHistoryMetadata";

export interface StorySprintHistoryCollection {
  sprints: SprintChoiceFieldsFragment[];
  total: number | null;
  loading: boolean;
  error: Error | undefined;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  retry: () => Promise<void>;
}

type PageStatus = "planned" | "completed";
function variables(projectId: string, status: PageStatus, search: string, offset = 0): SprintChoicePageQueryVariables {
  const order = status === "planned" ? "ASC" as const : "DESC" as const;
  return { filters: { projectId: { eq: compactWorktrackerId(projectId) }, status: { eq: status },
    ...(search ? { name: { contains: search } } : {}) }, order: { rank: order, id: order },
  pagination: { offset: { limit: 5, offset } } };
}

function useCollection(projectId: string | null, status: PageStatus, search: string, open: boolean): StorySprintHistoryCollection {
  const firstPage = useMemo(() => projectId ? variables(projectId, status, search) : null, [projectId, status, search]);
  const scope = JSON.stringify(firstPage);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const previousSearch = useRef(search);
  const request = useRef<{ scope: string; token: object } | null>(null);
  const meta = usePageMetadata((state) => state.scopes[scope] ?? emptyMetadata);
  const query = useQuery(SprintChoicePageDocument, firstPage ? {
    client: studioApolloClient(), variables: firstPage, fetchPolicy: "cache-only",
  } : skipToken);
  const fetchPage = useCallback(async (offset: number, reset = false): Promise<void> => {
    if (!firstPage || !projectId || request.current?.scope === scope) return;
    const client = studioApolloClient();
    const token = {};
    request.current = { scope, token };
    writeMetadata(scope, { projectId: compactWorktrackerId(projectId), loading: true,
      error: null, retryOffset: offset, retryReset: reset });
    try {
      const existing = client.readQuery({ query: SprintChoicePageDocument, variables: firstPage })?.sprints;
      const previous = existing?.nodes ?? [];
      const retainedOffset = offset === 0 && !reset
        ? usePageMetadata.getState().scopes[scope]?.nextOffset ?? 0 : 0;
      const fetchChoices = async (pageOffset: number) => {
        // Validate request ownership before Apollo can normalize or replace rows.
        if (currentScope.current !== scope || request.current?.token !== token) return null;
        const result = await client.query({ query: SprintChoicePageDocument,
          variables: variables(projectId, status, search, pageOffset), fetchPolicy: "no-cache",
          context: { queryDeduplication: false },
        });
        if (currentScope.current !== scope || request.current?.token !== token) return null;
        const page = result.data?.sprints;
        if (!page || !Array.isArray(page.nodes) || page.nodes.length > 5
          || page.nodes.some((sprint) => compactWorktrackerId(sprint.projectId) !== compactWorktrackerId(projectId)
            || sprint.status !== status) || typeof page.paginationInfo?.total !== "number"
          || typeof page.pageInfo?.hasNextPage !== "boolean") {
          throw new Error("Sprint choices are unavailable. Retry to load this page.");
        }
        return page;
      };
      let page = await fetchChoices(offset);
      if (!page) return;
      const merged = offset > 0 ? [...previous, ...page.nodes] : [...page.nodes];
      let nextOffset = offset + page.nodes.length;
      while (nextOffset < retainedOffset && page.pageInfo.hasNextPage && page.nodes.length > 0) {
        page = await fetchChoices(nextOffset);
        if (!page) return;
        merged.push(...page.nodes);
        nextOffset += page.nodes.length;
      }
      const seen = new Set<string>();
      const nodes = merged.filter((sprint) => {
        const id = compactWorktrackerId(sprint.id);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      if (currentScope.current !== scope || request.current?.token !== token) return;
      client.writeQuery({ query: SprintChoicePageDocument, variables: firstPage, data: {
        sprints: { ...page, nodes },
      } });
      writeMetadata(scope, { nextOffset, loading: false, error: null, invalidated: false });
    } catch (error) {
      if (currentScope.current === scope && request.current?.token === token) {
        writeMetadata(scope, { loading: false, error: error instanceof Error ? error.message : "Could not load sprint choices." });
      }
    } finally {
      if (request.current?.token === token) request.current = null;
    }
  }, [firstPage, projectId, scope, search, status]);

  useEffect(() => {
    if (previousSearch.current !== search) {
      previousSearch.current = search;
      writeMetadata(scope, { invalidated: true });
    }
    if (open) void fetchPage(0, usePageMetadata.getState().scopes[scope]?.invalidated);
    return () => {
      if (request.current?.scope === scope) {
        request.current = null;
        writeMetadata(scope, { loading: false });
      }
    };
  }, [open, scope, fetchPage, search]);

  const refresh = useCallback((reset = false) => {
    request.current = null;
    if (open) void fetchPage(0, reset || usePageMetadata.getState().scopes[scope]?.invalidated);
  }, [open, fetchPage, scope]);
  useEffect(() => {
    const focus = () => {
      if (projectId) invalidateSprintHistory(projectId);
      refresh(true);
    };
    window.addEventListener("focus", focus);
    const unsubscribe = subscribeSprintChoicesRefresh((changedProjectId) => {
      if (projectId && compactWorktrackerId(changedProjectId) === compactWorktrackerId(projectId)) {
        writeMetadata(scope, { invalidated: true });
        refresh();
      }
    });
    return () => { window.removeEventListener("focus", focus); unsubscribe(); };
  }, [projectId, scope, refresh]);

  const data = query.data?.sprints;
  return { sprints: (data?.nodes ?? []).map((sprint) => ({ ...sprint,
    id: publicWorktrackerId(sprint.id), projectId: publicWorktrackerId(sprint.projectId),
  })), total: data?.paginationInfo?.total ?? null,
  loading: meta.loading, error: meta.error ? new Error(meta.error) : undefined,
  hasMore: data?.pageInfo.hasNextPage ?? false,
  loadMore: () => data?.pageInfo.hasNextPage ? fetchPage(meta.nextOffset) : Promise.resolve(),
  retry: () => fetchPage(meta.retryOffset, meta.retryReset || meta.invalidated),
  };
}

export function useStorySprintHistory(projectId: string | null, search: string, open: boolean) {
  const name = search.trim();
  const planned = useCollection(projectId, "planned", name, open);
  const completed = useCollection(projectId, "completed", name, open);
  return { planned, completed };
}
