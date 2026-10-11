import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { createApolloStore } from "../../../shared/apollo/localState";

interface PageMetadata {
  projectId: string;
  nextOffset: number;
  retryOffset: number;
  retryReset: boolean;
  loading: boolean;
  error: string | null;
  invalidated: boolean;
}

export const emptyMetadata: PageMetadata = {
  projectId: "", nextOffset: 0, retryOffset: 0, retryReset: false,
  loading: false, error: null, invalidated: false,
};
export const usePageMetadata = createApolloStore<{ scopes: Record<string, PageMetadata> }>(
  "story-sprint-pages", () => ({ scopes: {} }),
);

export function writeMetadata(scope: string, change: Partial<PageMetadata>) {
  usePageMetadata.setState((state) => ({ scopes: { ...state.scopes,
    [scope]: { ...(state.scopes[scope] ?? emptyMetadata), ...change },
  } }));
}

export function invalidateSprintHistory(projectId: string): void {
  const canonicalId = compactWorktrackerId(projectId);
  usePageMetadata.setState((state) => ({ scopes: Object.fromEntries(Object.entries(state.scopes)
    .map(([scope, metadata]) => [scope, metadata.projectId === canonicalId
      ? { ...metadata, invalidated: true } : metadata])),
  }));
}
