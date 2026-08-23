import { isTauri } from "@tauri-apps/api/core";

import { tauriTerminalClient } from "./tauriTerminalClient";
import { unavailableTerminalTransport } from "./unavailableTerminalTransport";

export const terminalClientTransport = isTauri()
  ? tauriTerminalClient
  : unavailableTerminalTransport;
