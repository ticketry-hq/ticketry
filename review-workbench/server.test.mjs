import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createReviewServer } from "./server.mjs";

const validReview = JSON.parse(
  await readFile(
    new URL("../studio/src-tauri/resources/work-management/reviewed_defaults.json", import.meta.url),
    "utf8",
  ),
);

async function startServer(t, options) {
  const server = createReviewServer(options);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  assert(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

test("rejects invalid finalized defaults over HTTP without touching either file", async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "ticketry-review-"));
  const productionDefaultsPath = join(temporaryRoot, "reviewed-defaults.json");
  const agentsPath = join(temporaryRoot, "AGENTS.md");
  const artifactBefore = '{\n  "existing": "artifact bytes"\n}\n';
  const agentsBefore = "existing AGENTS.md bytes\n";
  await writeFile(productionDefaultsPath, artifactBefore, "utf8");
  await writeFile(agentsPath, agentsBefore, "utf8");

  const baseUrl = await startServer(t, {
    productionDefaultsPath,
    agentsPath,
  });
  const invalidReview = structuredClone(validReview);
  invalidReview.schemaVersion = 1;
  delete invalidReview.prompts.Story.Review;

  const response = await fetch(`${baseUrl}/api/finalized`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(invalidReview),
  });
  const result = await response.json();

  assert.equal(response.status, 422);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /Schema version/);
  assert.match(result.errors[1], /Story.*Review/);
  assert.equal(result.error, result.errors.join("\n"));
  assert.equal(await readFile(productionDefaultsPath, "utf8"), artifactBefore);
  assert.equal(await readFile(agentsPath, "utf8"), agentsBefore);
  assert.deepEqual((await readdir(temporaryRoot)).sort(), [
    "AGENTS.md",
    "reviewed-defaults.json",
  ]);
});

test("reads and writes the one tracked artifact over HTTP and derives AGENTS.md", async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "ticketry-review-"));
  const productionDefaultsPath = join(temporaryRoot, "reviewed-defaults.json");
  const agentsPath = join(temporaryRoot, "AGENTS.md");
  const previousReview = structuredClone(validReview);
  previousReview.guidance = "Previous guidance";
  await writeFile(
    productionDefaultsPath,
    `${JSON.stringify(previousReview, null, 2)}\n`,
    "utf8",
  );
  await writeFile(agentsPath, previousReview.guidance, "utf8");

  const baseUrl = await startServer(t, {
    productionDefaultsPath,
    agentsPath,
  });

  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /^text\/html/);
  assert.match(await page.text(), /Ticketry · Final review/);

  const before = await fetch(`${baseUrl}/api/finalized`);
  assert.deepEqual(await before.json(), { review: previousReview });

  const acceptedReview = structuredClone(validReview);
  acceptedReview.guidance = "Accepted guidance without an implicit newline.";
  acceptedReview.finalizedAt = new Date().toISOString();
  const saved = await fetch(`${baseUrl}/api/finalized`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(acceptedReview),
  });

  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).ok, true);
  assert.deepEqual(
    JSON.parse(await readFile(productionDefaultsPath, "utf8")),
    acceptedReview,
  );
  assert.equal(
    await readFile(agentsPath, "utf8"),
    acceptedReview.guidance,
  );
  assert.deepEqual((await readdir(temporaryRoot)).sort(), [
    "AGENTS.md",
    "reviewed-defaults.json",
  ]);

  const after = await fetch(`${baseUrl}/api/finalized`);
  assert.deepEqual(await after.json(), { review: acceptedReview });
});
