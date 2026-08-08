import { expect, test } from "@playwright/test";
import {
  CODEX_LUNA_MODEL,
  CODEX_LUNA_REASONING,
  ensureCodexLunaModel,
  responseJson,
} from "./support";

test("seeds Luna and completes first-run provider onboarding", async ({
  page,
  request,
}) => {
  const initialWorkspace = await responseJson<{ onboarding_required: boolean }>(
    await request.get("/api/work-tracker/workspace"),
  );
  expect(initialWorkspace.onboarding_required).toBe(true);
  await ensureCodexLunaModel(request);

  await page.goto("/");
  await expect(page.getByTestId("onboarding-welcome")).toBeVisible();

  const codex = page.getByRole("checkbox", { name: "I use codex" });
  const claude = page.getByRole("checkbox", { name: "I use claude" });
  await expect(codex).not.toBeChecked();
  await codex.check();
  await claude.check();
  await page.getByRole("combobox", { name: "Agent/provider" })
    .selectOption("codex");
  await page.getByLabel("Model").fill(CODEX_LUNA_MODEL);
  await page.getByRole("combobox", { name: "Reasoning" })
    .selectOption(CODEX_LUNA_REASONING);
  await page.getByRole("button", { name: /^(Continue|Get started)$/ }).click();

  const skipTour = page.getByTestId("onboarding-skip-tour");
  await expect(skipTour).toBeVisible();
  await skipTour.click();
  await expect(page.getByTestId("onboarding-welcome")).toHaveCount(0);

  const catalog = await responseJson<{
    value: {
      global_default: {
        provider: string;
        model: string | null;
        reasoning: string | null;
      } | null;
    };
  }>(await request.get("/api/settings/provider-catalog"));
  expect(catalog.value.global_default).toEqual({
    provider: "codex",
    model: CODEX_LUNA_MODEL,
    reasoning: CODEX_LUNA_REASONING,
  });

  const providers = await responseJson<Array<{
    slug: string;
    activated: boolean;
  }>>(await request.get("/api/work-tracker/providers"));
  expect(providers.find((provider) => provider.slug === "codex")?.activated)
    .toBe(true);
  expect(providers.find((provider) => provider.slug === "claude")?.activated)
    .toBe(true);
  expect(providers.find((provider) => provider.slug === "gemini")?.activated)
    .toBe(false);

  const finalWorkspace = await responseJson<{ onboarding_required: boolean }>(
    await request.get("/api/work-tracker/workspace"),
  );
  expect(finalWorkspace.onboarding_required).toBe(false);
});
