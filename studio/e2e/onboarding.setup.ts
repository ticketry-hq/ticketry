import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import {
  CODEX_TEST_MODEL,
  CODEX_TEST_REASONING,
  captureLegacyProductApiRequests,
  ensureCodexTestModel,
  getProviderCatalog,
  getWorkspace,
} from "./support";

test("uses the provisioned model and completes first-run provider onboarding", async ({
  page,
  request,
}) => {
  const legacyProductApiRequests = captureLegacyProductApiRequests(page);
  const initialWorkspace = await getWorkspace(request);
  expect(initialWorkspace.onboarding_required).toBe(true);
  await ensureCodexTestModel(request);

  await page.goto("/");
  await expect(page.getByTestId("onboarding-welcome")).toBeVisible();

  const codex = page.getByRole("checkbox", { name: "I use codex" });
  const claude = page.getByRole("checkbox", { name: "I use claude" });
  await expect(codex).not.toBeChecked();
  await codex.check();
  await expect(codex).toBeChecked();
  await claude.check();
  await expect(claude).toBeChecked();
  await page.getByRole("combobox", { name: "Agent/provider" })
    .selectOption("codex");
  await page.getByLabel("Model").fill(CODEX_TEST_MODEL);
  await page.getByRole("combobox", { name: "Reasoning" })
    .selectOption(CODEX_TEST_REASONING);
  await page.getByRole("button", { name: /^(Continue|Get started)$/ }).click();

  await expect(page.getByTestId("onboarding-welcome")).toHaveCount(0);
  await page.getByTestId("pane-modules")
    .getByRole("button", { name: "+ Add Module" })
    .click();
  await page.getByTestId("onboarding-module-name-next").click();
  await page.getByTestId("onboarding-module-folder-done").click();

  const moduleDialog = page.getByRole("dialog", { name: "Add Module" });
  await moduleDialog.getByPlaceholder("Module name")
    .fill("Onboarding Tour Module");
  await moduleDialog.getByRole("textbox", { name: "Module folder" })
    .fill(resolve(".."));
  await moduleDialog.getByRole("button", { name: "Create module" }).click();
  await expect(moduleDialog).toHaveCount(0);

  const idea = page.getByRole("textbox", { name: "Capture an idea" });
  await idea.fill("Story created during the onboarding tour");
  await idea.press("Enter");
  await expect(page.getByTestId("issue-name"))
    .toContainText("Story created during the onboarding tour");
  await page.getByTestId("onboarding-finish").click();
  await expect(page.getByTestId("onboarding-finish")).toHaveCount(0);

  const catalog = await getProviderCatalog(request);
  expect(catalog.global_default).toMatchObject({
    provider: "codex",
    model: CODEX_TEST_MODEL,
    reasoning: CODEX_TEST_REASONING,
  });

  const providers = catalog.configurable_providers;
  expect(providers.find((provider) => provider.slug === "codex")?.activated)
    .toBe(true);
  expect(providers.find((provider) => provider.slug === "claude")?.activated)
    .toBe(true);
  expect(providers.find((provider) => provider.slug === "gemini")?.activated)
    .toBe(false);

  const finalWorkspace = await getWorkspace(request);
  expect(finalWorkspace.onboarding_required).toBe(false);
  expect(legacyProductApiRequests).toEqual([]);
});
