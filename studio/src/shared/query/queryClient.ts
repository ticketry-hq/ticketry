import { QueryClient } from "@tanstack/react-query";

// The one QueryClient for the app. Module-level (not created in a component)
// so non-React code — the status-feed adapter, store actions during the
// migration — can read and patch the same cache the hooks subscribe to.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The status feed pushes authoritative deltas, so polling-style
      // refetching is mostly redundant; keep data fresh for a minute and lean
      // on invalidation for everything the feed covers.
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});
