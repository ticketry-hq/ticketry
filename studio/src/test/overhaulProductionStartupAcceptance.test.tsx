import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("[overhaul-365] initializes the workspace store in the production bundle before rendering", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `
  import { build } from "vite";
  import { resolve } from "node:path";
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: true,
      lib: {
        entry: resolve("src/features/workspace-state/workspaceStore.ts"),
        name: "TicketryStartup",
        formats: ["iife"],
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs.flatMap((output) => "output" in output ? output.output : [])
    .find((output) => output.type === "chunk" && output.isEntry);
  if (chunk?.type !== "chunk") throw new Error("Production entry chunk is missing");
  process.stdout.write(chunk.code);
  `], { maxBuffer: 10 * 1024 * 1024 });
  // Execute Rollup's output, rather than Vitest's unbundled module graph.
  // Eager namespace objects can expose circular imports only after bundling.
  const store = new Function(`${stdout}; return TicketryStartup.useClientStore;`)();
  expect(store.getInitialState().selectedModuleId).toBeNull();
  expect(store.getInitialState().selectModule).toBeTypeOf("function");
}, 60_000);
