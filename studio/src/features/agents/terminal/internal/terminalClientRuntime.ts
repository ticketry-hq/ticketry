import { isTauri } from "@tauri-apps/api/core";

import { browserTerminalClient } from "./browserTerminalClient";
import { tauriTerminalClient } from "./tauriTerminalClient";

export const terminalClientTransport = isTauri()
  ? tauriTerminalClient
  : browserTerminalClient;
