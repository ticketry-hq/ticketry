import { createApolloStore } from "../../shared/apollo/localState";

interface StoryReadMetadata { loading: boolean; error: string | null }
const empty: StoryReadMetadata = { loading: false, error: null };
export const useModuleStoryReadMetadata = createApolloStore<{ scopes: Record<string, StoryReadMetadata> }>(
  "module-manager-story-reads", () => ({ scopes: {} }),
);
export const moduleStoryScope = (projectId: string, moduleId: string) => `${projectId}:${moduleId}`;
export const emptyModuleStoryRead = empty;
export function writeModuleStoryRead(scope: string, update: Partial<StoryReadMetadata>): void {
  useModuleStoryReadMetadata.setState((state) => ({ scopes: { ...state.scopes, [scope]: { ...(state.scopes[scope] ?? empty), ...update } } }));
}
