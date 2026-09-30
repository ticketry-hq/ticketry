import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
try {
  for (const size of [50, 100, 250, 500]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("console", (message) => console.error("PAGE_CONSOLE", message.type(), message.text()));
    page.on("pageerror", (error) => console.error("PAGE_ERROR", error));
    await page.goto(`http://127.0.0.1:5174/selection-profile.html?size=${size}`);
    await page.waitForFunction(() => window.__profileReady === true);
    await page.waitForSelector(`[data-task-id="profile-${size - 1}"]`);
    const result = await page.evaluate(() => window.runSelectionProfile());
    console.log("BROWSER_SELECTION_PROFILE", JSON.stringify(result));
    await page.close();
  }
} finally {
  await browser.close();
}
