import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";

type DevelopmentConfiguration = {
  productName: string;
  identifier: string;
  app: { windows: Array<{ label: string; title: string }> };
};

it("launches a separately named desktop app beside installed Ticketry", async () => {
  const production = JSON.parse(
    await readFile(path.join(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
  ) as DevelopmentConfiguration;
  const development = JSON.parse(execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "import { buildTauriDevelopmentConfig } from './scripts/desktop-dev.mjs'; process.stdout.write(JSON.stringify(buildTauriDevelopmentConfig(5174)));",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  )) as DevelopmentConfiguration;

  expect(production).toMatchObject({
    productName: "Ticketry",
    identifier: "com.ticketry.desktop",
    app: { windows: [{ label: "main", title: "Ticketry" }] },
  });
  expect(development).toMatchObject({
    productName: "Ticketry Dev",
    identifier: "com.ticketry.desktop.dev",
    app: { windows: [{ label: "main", title: "Ticketry Dev" }] },
  });
});
