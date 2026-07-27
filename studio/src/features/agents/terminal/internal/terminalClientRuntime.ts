import { browserTerminalClient } from "./browserTerminalClient";

// Desktop temporarily shares the browser's backend tmux WebSocket transport.
export const terminalClientTransport = browserTerminalClient;
