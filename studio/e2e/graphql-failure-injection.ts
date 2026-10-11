import type { Page, Route } from "@playwright/test";

/**
 * Abort every browser GraphQL request for one operation until the returned
 * release runs. Failures are injected only at the network boundary; every
 * other request still reaches the Rust adapter.
 */
export async function failGraphqlOperation(
  page: Page,
  operationName: string,
): Promise<() => Promise<void>> {
  const handler = async (route: Route) => {
    if (route.request().postDataJSON()?.operationName === operationName) {
      return route.abort("failed");
    }
    return route.fallback();
  };
  await page.route("**/graphql", handler);
  return async () => { await page.unroute("**/graphql", handler); };
}

/**
 * Hold browser GraphQL requests for one operation until `release` runs, then
 * send them unchanged. Lets a test change server state while a request that
 * was built from older state is still in flight.
 */
export async function holdGraphqlOperation(
  page: Page,
  operationName: string,
): Promise<{ held: Promise<void>; release: () => Promise<void> }> {
  let markHeld = () => {};
  const held = new Promise<void>((resolve) => { markHeld = resolve; });
  let open = () => {};
  const gate = new Promise<void>((resolve) => { open = resolve; });
  let markSent = () => {};
  const sent = new Promise<void>((resolve) => { markSent = resolve; });
  const handler = async (route: Route) => {
    if (route.request().postDataJSON()?.operationName !== operationName) {
      return route.fallback();
    }
    markHeld();
    await gate;
    await route.continue();
    markSent();
  };
  await page.route("**/graphql", handler);
  return {
    held,
    // Call after `held`: the held request is sent before the route is removed.
    release: async () => {
      open();
      await sent;
      await page.unroute("**/graphql", handler);
    },
  };
}
