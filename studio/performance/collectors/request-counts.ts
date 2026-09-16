import type { Page, Request } from "@playwright/test";

/**
 * GraphQL operation counting from the runner side.
 *
 * Playwright already sees every request, so nothing in the application is
 * patched or wrapped to get these numbers. Operation names, counts and
 * durations are recorded; request and response bodies never are.
 *
 * One limit is recorded rather than papered over: the subscription route is a
 * single long-lived streaming POST, so its request count says how many streams
 * opened and says nothing at all about how many events arrived.
 */
export interface OperationWindow {
  [operationName: string]: { count: number; totalMs: number; maxMs: number };
}

const SUBSCRIPTION_PATH = "/graphql/subscribe";

export function createRequestCounter(page: Page) {
  const windows = new Map<string, OperationWindow>();
  const failures: string[] = [];
  let current: string | null = null;
  let streamsAborted = 0;

  const isSubscriptionStream = (request: Request): boolean =>
    new URL(request.url()).pathname === SUBSCRIPTION_PATH;

  const operationNameOf = (request: Request): string => {
    const url = new URL(request.url());
    if (url.pathname === SUBSCRIPTION_PATH) return "subscription-stream-open";
    if (!url.pathname.endsWith("/graphql")) return `http ${request.method()} ${url.pathname}`;
    try {
      const body = request.postDataJSON() as { operationName?: string } | null;
      return body?.operationName ?? "anonymous-graphql-operation";
    } catch {
      return "unparsed-graphql-operation";
    }
  };

  const record = (request: Request, durationMs: number) => {
    if (!current) return;
    const window = windows.get(current)!;
    const name = operationNameOf(request);
    const entry = window[name] ?? { count: 0, totalMs: 0, maxMs: 0 };
    entry.count += 1;
    if (Number.isFinite(durationMs) && durationMs >= 0) {
      entry.totalMs += durationMs;
      if (durationMs > entry.maxMs) entry.maxMs = durationMs;
    }
    window[name] = entry;
  };

  const onFinished = (request: Request) => {
    // Playwright reports `startTime` as an epoch timestamp and every other
    // field as milliseconds relative to it, so `responseEnd` is already the
    // duration. Subtracting the two would report the epoch as a duration.
    record(request, request.timing().responseEnd);
  };
  const onFailed = (request: Request) => {
    record(request, Number.NaN);
    if (isSubscriptionStream(request)) {
      // The subscription is one long-lived streaming POST. Navigating away or
      // closing the page aborts it by design; that is not a request failure.
      streamsAborted += 1;
      return;
    }
    if (current && failures.length < 50) {
      failures.push(`${current}: ${request.method()} ${request.url()} failed`);
    }
  };
  page.on("requestfinished", onFinished);
  page.on("requestfailed", onFailed);

  return {
    /** Everything until the next `startWindow` is attributed to this label. */
    startWindow(label: string) {
      if (!windows.has(label)) windows.set(label, {});
      current = label;
    },
    endWindow() {
      current = null;
    },
    windows(): Record<string, OperationWindow> {
      return Object.fromEntries(windows);
    },
    failures(): string[] {
      return [...failures];
    },
    /** Subscription streams torn down with the page, counted rather than failed. */
    streamsAborted(): number {
      return streamsAborted;
    },
    dispose() {
      page.off("requestfinished", onFinished);
      page.off("requestfailed", onFailed);
      current = null;
    },
    note:
      "Counts of HTTP requests observed by the runner. The subscription route "
      + "is one streaming POST per stream, so its count is a stream count and "
      + "never an event count.",
  };
}

export type RequestCounter = ReturnType<typeof createRequestCounter>;
