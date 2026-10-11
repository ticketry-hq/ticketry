import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page } from "@playwright/test";

const verificationScript = fileURLToPath(
  new URL("../scripts/read-persisted-model-settings.mjs", import.meta.url),
);

export interface PersistedModelSettings {
  database_path: string;
  global_default: {
    provider: string;
    profile: string | null;
    model: string | null;
    reasoning: string | null;
  } | null;
  mismatches: string[];
}

/**
 * Read the stored default straight out of `state.db`. The script exits nonzero
 * when the row disagrees with the expectation, so a cached or unwritten save
 * fails here rather than passing on the response the UI already showed. The
 * feature runner owns the profile, so read that directory rather than the
 * newest temporary profile another concurrent run may have created.
 */
export function readPersistedModelSettings(expected: {
  provider: string;
  model: string;
  reasoning: string;
}): PersistedModelSettings {
  const stdout = execFileSync(process.execPath, [
    verificationScript,
    ...profileArguments(),
    "--expect-provider",
    expected.provider,
    "--expect-model",
    expected.model,
    "--expect-reasoning",
    expected.reasoning,
  ], { encoding: "utf8" });
  return JSON.parse(stdout) as PersistedModelSettings;
}

function profileArguments(): string[] {
  const dataDirectory = process.env.TICKETRY_E2E_DATA_DIR;
  return dataDirectory ? ["--data-dir", dataDirectory] : ["--temp-profile"];
}

/** Open the singleton Settings dialog from the footer of a loaded module. */
export async function openSettings(page: Page): Promise<Locator> {
  await expect(page.getByTestId("module-workspace-region")).toBeVisible();
  await page.getByRole("button", { name: "Open Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Studio settings" });
  await expect(dialog).toBeVisible();
  return dialog;
}
