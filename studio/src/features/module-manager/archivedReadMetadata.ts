import { createApolloStore } from "../../shared/apollo/localState";

interface ArchivedReadMetadata {
  loading: boolean;
  error: string | null;
  refreshModuleIds?: string[];
}

export const emptyArchivedMetadata: ArchivedReadMetadata = { loading: false, error: null };
export const useArchivedReadMetadata = createApolloStore<{
  projects: Record<string, ArchivedReadMetadata>;
}>("module-manager-archived-reads", () => ({ projects: {} }));

export function writeArchivedReadMetadata(projectId: string, change: Partial<ArchivedReadMetadata>) {
  useArchivedReadMetadata.setState((state) => ({ projects: {
    ...state.projects,
    [projectId]: { ...(state.projects[projectId] ?? emptyArchivedMetadata), ...change },
  } }));
}
