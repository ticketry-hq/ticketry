import type { ProxyOptions } from "vite";

// Studio dev proxy table (:5174).
// /api forwards same-origin to the worktracker backend, so the x-api-key
// client never triggers CORS and the backend needs no CORS header.
//
// Studio opens the terminal stream on `/ws/terminal` and the project status
// feed on `/ws/status`; both are forwarded to this instance's selected backend.
export function developmentProxy(
  backendOrigin = process.env.MUXED_VITE_BACKEND_ORIGIN ?? "http://127.0.0.1:8787",
): Record<string, ProxyOptions> {
  const webSocketOrigin = backendOrigin.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  return {
    "/api": {
      target: backendOrigin,
      changeOrigin: false,
      ws: true,
    },
    "/ws": {
      target: webSocketOrigin,
      changeOrigin: false,
      ws: true,
    },
  };
}

export const devProxy = developmentProxy();
