import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("[overhaul-245] fresh bound launches type only the provider-formatted entry skill", () => {
  const runtime = readFileSync(
    join(process.cwd(), "src-tauri", "src", "terminal", "lifecycle", "work.rs"),
    "utf8",
  );
  const delivery = readFileSync(
    join(process.cwd(), "src-tauri", "src", "terminal", "prompt_delivery", "mod.rs"),
    "utf8",
  );

  expect(runtime).toContain("entry_skill_for_effect");
  expect(runtime).toContain("entry_skill_invocation(provider, &skill)");
  expect(runtime).toContain("prompt_delivery::submit_text");
  expect(runtime).toContain("adapter.kill_verified(&identity)");
  expect(delivery).toContain("provider_contract(provider).invocation_prefix");
});
