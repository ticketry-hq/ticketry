import { expect, test as base } from "@playwright/test";
import { captureLegacyProductApiRequests, getWorkspace } from "./support";

export const test = base.extend<{ planningHealth: void }>({
  planningHealth: [async ({ page, request }, use, testInfo) => {
    testInfo.setTimeout(90_000);
    page.setDefaultTimeout(10_000);
    await getWorkspace(request);
    await page.routeWebSocket((url) => url.pathname === "/" && url.searchParams.has("token"), () => {});
    const legacy = captureLegacyProductApiRequests(page);
    await use();
    expect(legacy).toEqual([]);
  }, { auto: true }],
});
export { expect };
