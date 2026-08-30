import {
  installFrontendLogBridge,
  type FrontendLogInvoke,
} from "./frontendLogBridge";

export type DesktopFileLoggingInvoke = FrontendLogInvoke & (
  (command: "desktop_file_logging_enabled") => Promise<unknown>
);

export interface DesktopFileLoggingOptions {
  invoke: DesktopFileLoggingInvoke;
  targetConsole?: Console;
  targetWindow?: Window;
}

/** Install the webview bridge only when this desktop process enabled its file log. */
export async function installDesktopFileLogging({
  invoke,
  targetConsole,
  targetWindow,
}: DesktopFileLoggingOptions): Promise<() => void> {
  let enabled: unknown;
  try {
    enabled = await invoke("desktop_file_logging_enabled");
  } catch (error) {
    console.warn("[file-logging] Could not read desktop logging status", error);
    return () => {};
  }
  if (enabled !== true) return () => {};
  return installFrontendLogBridge({ invoke, targetConsole, targetWindow });
}
