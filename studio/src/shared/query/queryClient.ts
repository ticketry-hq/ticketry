import { QueryClient } from "@tanstack/react-query";

export const FIVE_MINUTES = 5 * 60 * 1_000;

// The one QueryClient for the app. Module-level (not created in a component)
// so non-React code — the status-feed adapter, store actions during the
// migration — can read and patch the same cache the hooks subscribe to.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The status feed pushes authoritative deltas. Keep an ordinary
      // staleness window as a safety net without treating records as current
      // forever.
      staleTime: FIVE_MINUTES,
      // No automatic retry: the surfaces this replaced surfaced the first
      // failure directly, and silently re-issuing writes/reads would be a
      // behaviour change rather than a refactor.
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});
