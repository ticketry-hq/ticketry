import { expect, test } from "@playwright/test";
import {
  acknowledgeOnboarding,
  CODEX_TEST_MODEL,
  CODEX_TEST_REASONING,
  ensureCodexTestModel,
  getProviderCatalog,
  getWorkspace,
} from "./support";

test("uses the provisioned model and completes first-run provider onboarding", async ({
  page,
  request,
}) => {
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

  const skipTour = page.getByTestId("onboarding-skip-tour");
  await expect(page.getByTestId("onboarding-welcome")).toHaveCount(0);
  if (await skipTour.isVisible()) {
    await skipTour.click();
  } else {
    await acknowledgeOnboarding(request);
  }

  const catalog = await getProviderCatalog(request);
  expect(catalog.global_default).toEqual({
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
});
