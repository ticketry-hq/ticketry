import {
  installFrontendLogBridge,
  type FrontendLogInvoke,
} from "./frontendLogBridge";

const WEB_FRONTEND_LOG_ENDPOINT = "/__ticketry/frontend-log";

export interface WebFileLoggingOptions {
  enabled?: boolean;
  targetConsole?: Console;
  targetFetch?: typeof fetch;
  targetWindow?: Window;
}

/** Mirror browser console records through the local Vite development server. */
export async function installWebFileLogging({
  enabled = import.meta.env.VITE_TICKETRY_WEB_FILE_LOGGING === "true",
  targetConsole,
  targetFetch = fetch,
  targetWindow,
}: WebFileLoggingOptions = {}): Promise<() => void> {
  if (!enabled) return () => {};
  const invoke: FrontendLogInvoke = async (_command, args) => {
    const response = await targetFetch(WEB_FRONTEND_LOG_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!response.ok) {
      throw new Error(`Web frontend logging failed with HTTP ${response.status}`);
    }
  };
  return installFrontendLogBridge({ invoke, targetConsole, targetWindow });
}

