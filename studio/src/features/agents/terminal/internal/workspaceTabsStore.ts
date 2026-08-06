// Compatibility seam. Terminal selection is client intent and therefore lives
// in the single client store. The tab set is
// derived from pushed runs plus the live terminal registry; no tab list is
// stored here or anywhere else.
export { useClientStore as useWorkspaceTabsStore } from "../../../../state/clientStore";
export type { ClientState as WorkspaceTabsState } from "../../../../state/clientStore";
