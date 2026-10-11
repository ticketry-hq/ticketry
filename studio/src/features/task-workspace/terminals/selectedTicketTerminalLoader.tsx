import { lazy } from "react";

// Stable loader shared by the lazy boundary and the launcher's intent
// preload, so hovering/focusing the launcher starts the (large) terminal
// chunk download before a run is actually started.
export const loadSelectedTicketTerminal = () =>
  import("./SelectedTicketTerminal");

export const LazySelectedTicketTerminal = lazy(async () => ({
  default: (await loadSelectedTicketTerminal()).SelectedTicketTerminal,
}));
