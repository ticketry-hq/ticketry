// Compatibility seam for workspace callers. Workspace state is a slice of the
// single client store; this module owns no state of its own.
export {
  DEFAULT_WORKSPACE,
  useClientStore as useTicketWorkspaceStore,
  type TicketWorkspaceViewState,
} from "../../../../../state/clientStore";
