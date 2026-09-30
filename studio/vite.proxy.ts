import type { ProxyOptions } from "vite";

// Studio dev proxy table (:5174).
// /graphql forwards same-origin to the Rust browser-development adapter.
//
// GraphQL subscriptions use an SSE-over-fetch POST. There is
// no WebSocket entry on that route. Terminal bytes attach through the
// adapter's /ws/terminal socket, forwarded with WebSocket upgrades enabled.
export function developmentProxy(
  graphQlOrigin = process.env.MUXED_VITE_GRAPHQL_ORIGIN ?? "http://127.0.0.1:8790",
): Record<string, ProxyOptions> {
  return {
    "/graphql/subscribe": {
      target: graphQlOrigin,
      changeOrigin: false,
    },
    "/graphql": {
      target: graphQlOrigin,
      changeOrigin: false,
    },
    "/documents": {
      target: graphQlOrigin,
      changeOrigin: false,
    },
    "/ws/terminal": {
      target: graphQlOrigin,
      changeOrigin: false,
      ws: true,
    },
  };
}

export const devProxy = developmentProxy();
