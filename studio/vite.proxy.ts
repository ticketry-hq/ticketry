import type { ProxyOptions } from "vite";

// Studio dev proxy table (:5174).
// /graphql forwards same-origin to the Rust browser-development adapter.
//
// There is no WebSocket entry. The project status socket was retired at the
// Slice 3 handoff and the `/ws/terminal` stream at the Slice 5 terminal
// cutover: status is a GraphQL subscription and terminal bytes come from the
// Rust tmux adapter, both over the desktop's in-process transport, which no
// proxy is involved in.
export function developmentProxy(
  graphQlOrigin = process.env.MUXED_VITE_GRAPHQL_ORIGIN ?? "http://127.0.0.1:8790",
): Record<string, ProxyOptions> {
  return {
    "/graphql": {
      target: graphQlOrigin,
      changeOrigin: false,
    },
    "/documents": {
      target: graphQlOrigin,
      changeOrigin: false,
    },
  };
}

export const devProxy = developmentProxy();
