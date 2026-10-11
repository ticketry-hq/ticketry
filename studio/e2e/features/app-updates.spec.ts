import { expect, test, type Page } from "@playwright/test";
import { featureSuite } from "./featureSuite";

async function openAppUpdates(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Studio settings" });
  await expect(dialog).toBeVisible();
  const tab = dialog.getByRole("tab", { name: "App updates", exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  return { dialog, tab };
}

featureSuite("app-updates", () => {
  test("states that the desktop app manages updates and offers no browser update actions", { tag: "@case-app-updates-browser-boundary" }, async ({ page }) => {
    let feedRequests = 0;
    page.on("request", (request) => { if (/releases|latest\.json|updater/i.test(request.url())) feedRequests += 1; });
    await page.goto("/");
    await expect(page.getByTestId("module-workspace-region")).toBeVisible();
    const opener = page.getByRole("button", { name: "Open Settings" });
    // No launch check runs in the browser, so neither opener carries availability.
    await expect(opener).not.toHaveAttribute("aria-describedby", /update-available/);
    await expect(page.getByTitle("Update available")).toHaveCount(0);

    for (const open of [() => opener.click(), async () => { await opener.focus(); await page.keyboard.press("e"); }]) {
      await open();
      const { dialog, tab } = await openAppUpdates(page);
      await expect(tab).not.toHaveAttribute("aria-describedby", /update-available/);
      const section = dialog.getByRole("region", { name: "App updates" });
      await expect(section.getByRole("heading", { name: "App updates", level: 2 })).toBeVisible();
      await expect(section).toContainText("Updates are managed by the desktop app.");
      await expect(section.getByRole("button")).toHaveCount(0);
      await expect(section.getByRole("progressbar")).toHaveCount(0);
      await expect(section.getByRole("alert")).toHaveCount(0);
      await expect(section).not.toContainText("Ticketry is up to date");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    }

    await page.reload();
    await expect(page.getByTestId("module-workspace-region")).toBeVisible();
    await expect(page.getByTitle("Update available")).toHaveCount(0);
    await opener.click();
    const { dialog } = await openAppUpdates(page);
    await expect(dialog.getByRole("region", { name: "App updates" })).toContainText("Updates are managed by the desktop app.");
    expect(feedRequests).toBe(0);
  });
});
