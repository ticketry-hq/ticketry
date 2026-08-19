import type { ProxyOptions } from "vite";

// Studio dev proxy table (:5174).
// /api forwards same-origin to the worktracker backend, so the x-api-key
// client never triggers CORS and the backend needs no CORS header.
//
// Studio opens the terminal stream on `/ws/terminal`, which is forwarded to
// this instance's selected backend. The project status WebSocket was retired
// at the Slice 3 handoff: status is a GraphQL subscription over the desktop's
// in-process transport, which no proxy is involved in.
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
