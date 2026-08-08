import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/keys";
import * as api from "./api";
import { useChatStore } from "./store";
import type { ChatSessionSummary } from "./types";

const EMPTY_SESSIONS: ChatSessionSummary[] = [];

/** Load the durable Chat tab index before each tab opens its replay stream. */
export function usePersistedChatSessions(taskId: string | null): {
  sessions: ChatSessionSummary[];
  isFetched: boolean;
} {
  const query = useQuery(
    {
      queryKey: queryKeys.chatSessions.persisted(taskId ?? "none"),
      queryFn: ({ signal }) => api.listChatSessions(taskId!, signal),
      enabled: taskId !== null,
      staleTime: 0,
    },
    queryClient,
  );
  useEffect(() => {
    if (taskId && query.data) {
      useChatStore.getState().hydrateTask(taskId, query.data);
    }
  }, [query.data, taskId]);
  return { sessions: query.data ?? EMPTY_SESSIONS, isFetched: query.isFetched };
}
