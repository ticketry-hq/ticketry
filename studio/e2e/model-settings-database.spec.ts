import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  captureLegacyProductApiRequests,
  configureCodexDefault,
} from "./support";

const verificationScript = fileURLToPath(
  new URL("../scripts/read-persisted-model-settings.mjs", import.meta.url),
);

const CHANGED_PROVIDER = "claude";
const CHANGED_MODEL = "opus";
const CHANGED_REASONING = "high";

interface PersistedModelSettings {
  database_path: string;
  global_default: {
    provider: string;
    model: string | null;
    reasoning: string | null;
  } | null;
  mismatches: string[];
}

/**
 * Read the stored default straight out of `state.db`. The script exits nonzero
 * when the row disagrees with the expectation, so a cached or unwritten save
 * fails here rather than passing on the response the UI already showed.
 */
function readPersistedModelSettings(expected: {
  provider: string;
  model: string;
  reasoning: string;
}): PersistedModelSettings {
  const stdout = execFileSync(process.execPath, [
    verificationScript,
    "--temp-profile",
    "--expect-provider",
    expected.provider,
    "--expect-model",
    expected.model,
    "--expect-reasoning",
    expected.reasoning,
  ], { encoding: "utf8" });
  return JSON.parse(stdout) as PersistedModelSettings;
}

test.beforeAll(async ({ request }) => {
  await configureCodexDefault(request);
});

test.afterAll(async ({ request }) => {
  // Restore the deterministic default the rest of the suite launches against.
  await configureCodexDefault(request);
});

test("persists a Models settings change into the state database", async ({
  page,
}) => {
  const legacyProductApiRequests = captureLegacyProductApiRequests(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Open Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Studio settings" });
  await expect(dialog.getByRole("region", { name: "Model configuration" }))
    .toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Agent/provider" }))
    .toHaveValue("codex");

  await dialog.getByRole("checkbox", { name: `Activate ${CHANGED_PROVIDER}` })
    .setChecked(true);
  // Choosing a provider clears the dependent model and reasoning fields, so the
  // three controls have to be set in that order.
  await dialog.getByRole("combobox", { name: "Agent/provider" })
    .selectOption(CHANGED_PROVIDER);
  await dialog.getByRole("combobox", { name: "Model" }).fill(CHANGED_MODEL);
  await dialog.getByRole("combobox", { name: "Reasoning" })
    .selectOption(CHANGED_REASONING);
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toContainText("Model configuration saved.");

  const persisted = readPersistedModelSettings({
    provider: CHANGED_PROVIDER,
    model: "sonnet",
    reasoning: CHANGED_REASONING,
  });
  expect(persisted.mismatches).toEqual([]);
  expect(persisted.global_default).toEqual({
    provider: CHANGED_PROVIDER,
    model: CHANGED_MODEL,
    reasoning: CHANGED_REASONING,
  });

  // The stored row is what a fresh client reads back.
  await page.reload();
  await page.getByRole("button", { name: "Open Settings" }).click();
  await expect(dialog.getByRole("combobox", { name: "Agent/provider" }))
    .toHaveValue(CHANGED_PROVIDER);
  await expect(dialog.getByRole("combobox", { name: "Model" }))
    .toHaveValue(CHANGED_MODEL);
  await expect(dialog.getByRole("combobox", { name: "Reasoning" }))
    .toHaveValue(CHANGED_REASONING);
  await dialog.getByRole("button", { name: "Close dialog" }).click();

  expect(legacyProductApiRequests).toEqual([]);
});
