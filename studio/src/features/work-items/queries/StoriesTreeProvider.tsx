import { createContext, useContext, type ReactNode } from "react";
import { useDerivedStoriesTree } from "./useStoriesTree";

const StoriesTreeContext = createContext<ReturnType<typeof useDerivedStoriesTree> | null>(null);

/** React owns this derived view; normalized records remain in Apollo. */
export function StoriesTreeProvider({ children }: { children: ReactNode }) {
  const inherited = useContext(StoriesTreeContext);
  return inherited ? children : <StoriesTreeOwner>{children}</StoriesTreeOwner>;
}

function StoriesTreeOwner({ children }: { children: ReactNode }) {
  const tree = useDerivedStoriesTree();
  return <StoriesTreeContext.Provider value={tree}>{children}</StoriesTreeContext.Provider>;
}

export function useStoriesTree() {
  const tree = useContext(StoriesTreeContext);
  if (!tree) throw new Error("Stories must be rendered inside StoriesTreeProvider");
  return tree;
}
