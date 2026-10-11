import { expect, test } from "@playwright/test";
import { featureSuite } from "./featureSuite";

featureSuite("startup-and-service-health", () => {
  test("recovers bootstrap after the local Rust adapter is initially unavailable", { tag: "@case-startup-bootstrap-retry" }, async ({ page }) => {
    await page.route("**/graphql", (route) => route.abort());
    await page.goto("/");
    await expect(page.getByText("The local server is not running.")).toBeVisible();
    const retry = page.getByRole("button", { name: "Retry", exact: true });
    await expect(retry).toBeVisible();
    await page.unroute("**/graphql");
    await retry.click();
    await expect(page.getByRole("tablist", { name: "Project module tabs" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("tab", { name: "Onboarding Tour Module", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("tablist", { name: "Project module tabs" })).toBeVisible();
  });

  test("automatically retries bootstrap after a network failure", { tag: "@case-startup-automatic-retry" }, async ({ page }) => {
    let unavailable = true;
    await page.route("**/graphql", (route) => unavailable ? route.abort() : route.continue());
    await page.goto("/");
    await expect(page.getByText("The local server is not running.")).toBeVisible();
    unavailable = false;
    await expect(page.getByRole("tablist", { name: "Project module tabs" })).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByRole("tablist", { name: "Project module tabs" })).toBeVisible();
  });

  test("keeps Settings reachable while connecting and returns to the gate on cancel", { tag: "@case-startup-connecting-settings" }, async ({ page }) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/graphql", async (route) => { await pending; await route.continue(); });
    try {
      await page.goto("/");
      await expect(page.getByText("One moment…", { exact: true })).toBeVisible();
      await expect(page.getByRole("tablist", { name: "Project module tabs" })).toHaveCount(0);
      await page.getByRole("button", { name: "Open Settings", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Studio settings", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Studio settings", exact: true })).toHaveCount(0);
      await expect(page.getByText("One moment…", { exact: true })).toBeVisible();
    } finally { release(); }
    await expect(page.getByRole("tablist", { name: "Project module tabs" })).toBeVisible();
  });

  test("opens Settings from unavailable and provisioning gates without bypassing recovery", { tag: "@case-startup-error-settings" }, async ({ page }) => {
    let mode = "unavailable";
    await page.route("**/graphql", (route) => mode === "unavailable"
      ? route.abort()
      : route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message: "Injected startup read failure" }] }) }));
    await page.goto("/");
    await expect(page.getByText("The local server is not running.")).toBeVisible();
    await page.getByRole("button", { name: "Open Settings", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Studio settings", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tablist", { name: "Project module tabs" })).toHaveCount(0);
    mode = "provisioning";
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByText("The local work tracker is still starting up. Retrying…", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open Settings", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Studio settings", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.unroute("**/graphql");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("tablist", { name: "Project module tabs" })).toBeVisible();
  });

  test("restores the linked module and selected Story after reload", { tag: "@case-startup-workspace-reload" }, async ({ page }) => {
    await page.goto("/");
    const module = page.getByRole("tab", { name: "Onboarding Tour Module", exact: true });
    await module.click();
    await page.getByRole("treeitem", { name: /Story created during the onboarding tour/ }).click();
    await expect(page.getByTestId("issue-name")).toContainText("Story created during the onboarding tour");
    await page.reload();
    await expect(module).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("issue-name")).toContainText("Story created during the onboarding tour");
    await expect(page.getByRole("form", { name: "Create module", exact: true })).toHaveCount(0);
  });

  test("restores a remembered scratch workspace without starting a conversation", { tag: "@case-startup-scratch-reload" }, async ({ page }) => {
    await page.goto("/");
    const module = page.getByRole("tab", { name: "Onboarding Tour Module", exact: true });
    await module.click();
    const moduleId = await module.getAttribute("data-module-id");
    // Existing client navigation preference is the restoration precondition;
    // clicking New conversation now launches a run rather than selecting scratch.
    await page.evaluate((id) => localStorage.setItem("studio.selectedTaskByModule:v1", JSON.stringify({ [id!]: "__scratch__" })), moduleId);
    await page.reload();
    await expect(module).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("treeitem", { name: /New conversation/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("issue-name")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("treeitem", { name: /New conversation/ })).toHaveAttribute("aria-selected", "true");
  });

  test("keeps an all-hidden workspace empty through startup and restores its tab from the picker", { tag: "@case-startup-hidden-module" }, async ({ page }) => {
    await page.goto("/");
    const module = page.getByRole("tab", { name: "Onboarding Tour Module", exact: true });
    await module.click();
    await page.getByRole("button", { name: "Hide Onboarding Tour Module tab", exact: true }).click();
    await expect(module).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("empty-module-workspace")).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Project module tabs" }).getByRole("tab", { selected: true })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: /folder/i })).toHaveCount(0);
    await page.getByRole("button", { name: "Open module picker", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Module picker", exact: true });
    const search = picker.getByRole("combobox", { name: "Search modules" });
    await search.fill("Onboarding Tour Module");
    await search.press("ArrowDown");
    await search.press("Enter");
    await expect(module).toHaveAttribute("aria-selected", "true");
    await page.reload();
    await expect(module).toHaveAttribute("aria-selected", "true");
  });

  test("leaves a removed remembered module unselected without prompting for a folder", { tag: "@case-startup-missing-module" }, async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("tablist", { name: "Project module tabs" })).toBeVisible();
    // Navigation preference only; this does not manufacture successful server state.
    await page.evaluate(() => localStorage.setItem("studio.recentModule:v1", "00000000-0000-4000-8000-000000000000"));
    await page.reload();
    await expect(page.getByRole("tab", { name: "Onboarding Tour Module", exact: true })).toHaveAttribute("aria-selected", "false");
    await expect(page.getByRole("region", { name: "Sprint module recovery" })).toContainText("Select a module to view its stories.");
    await expect(page.getByRole("form", { name: "Create module", exact: true })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: /folder/i })).toHaveCount(0);
  });
});
