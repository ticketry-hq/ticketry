import { createApolloStore } from "../../../../shared/apollo/localState";

interface ModulePullRequestState {
  urls: Record<string, string>;
  remember: (key: string, url: string) => void;
}

export const useModulePullRequestState = createApolloStore<ModulePullRequestState>(
  "module-pull-request-urls",
  (set) => ({
    urls: {},
    remember: (key, url) => set((state) => ({
      urls: { ...state.urls, [key]: url },
    })),
  }),
);

export function modulePullRequestKey(
  moduleId: string,
  branch?: string | null,
): string {
  return `${moduleId}:${branch ?? "none"}`;
}
