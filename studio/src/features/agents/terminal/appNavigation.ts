// Narrow public seam for the app-level navigation coordinator. Keep this
// value surface small so mounting the global keymap does not traverse the
// terminal UI and launch barrels.
export {
  bucketFor,
  isScratchBucket,
  useTerminalStore,
  type SessionMeta,
} from "./internal/sessionStore";
export { useWorkspaceTabsStore } from "./internal/workspaceTabsStore";
export {
  foregroundKey,
  useTerminalForegroundStore,
} from "./internal/foregroundStore";
