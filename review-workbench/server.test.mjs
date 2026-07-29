import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createReviewHandler } from "./server.mjs";

const states = [
  "Idea",
  "Refinement",
  "Ready",
  "Implement",
  "Review",
  "Done",
  "Cancelled",
];

const validReview = {
  schemaVersion: 1,
  agentsMd: "# Ticketry",
  prompts: Object.fromEntries(
    ["Story", "PathFind", "Implementation"].map((type) => [
      type,
      Object.fromEntries(states.map((state) => [state, `${type} ${state}`])),
    ]),
  ),
};

async function call(handler, path, { method = "GET", body } = {}) {
  const request = {
    url: path,
    method,
    async *[Symbol.asyncIterator]() {
      if (body) yield Buffer.from(body);
    },
  };
  const result = { status: null, headers: {}, body: "" };
  const response = {
    writeHead(status, headers = {}) {
      result.status = status;
      result.headers = headers;
    },
    end(value = "") {
      result.body = Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
    },
  };
  await handler(request, response);
  return {
    status: result.status,
    contentType: result.headers["content-type"],
    body: result.body,
  };
}

test("serves the workbench and persists a finalized review atomically", async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "ticketry-review-"));
  const finalizedPath = join(temporaryRoot, "finalized.json");
  const productionDefaultsPath = join(temporaryRoot, "reviewed-defaults.json");
  const agentsPath = join(temporaryRoot, "AGENTS.md");
  const handler = createReviewHandler({
    finalizedPath,
    productionDefaultsPath,
    agentsPath,
  });

  const page = await call(handler, "/");
  assert.equal(page.status, 200);
  assert.match(page.contentType, /^text\/html/);
  assert.match(page.body, /Ticketry · Final review/);

  const before = await call(handler, "/api/finalized");
  assert.deepEqual(JSON.parse(before.body), { review: null });

  const saved = await call(handler, "/api/finalized", {
    method: "POST",
    body: JSON.stringify(validReview),
  });
  assert.equal(saved.status, 200);
  assert.equal(JSON.parse(saved.body).ok, true);
  assert.deepEqual(JSON.parse(await readFile(finalizedPath, "utf8")), validReview);
  assert.deepEqual(
    JSON.parse(await readFile(productionDefaultsPath, "utf8")),
    validReview,
  );
  assert.equal(await readFile(agentsPath, "utf8"), "# Ticketry\n");

  const after = await call(handler, "/api/finalized");
  assert.deepEqual(JSON.parse(after.body), { review: validReview });
});

test("rejects an incomplete prompt matrix", async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "ticketry-review-"));
  const handler = createReviewHandler({
    finalizedPath: join(temporaryRoot, "finalized.json"),
    productionDefaultsPath: join(temporaryRoot, "reviewed-defaults.json"),
    agentsPath: join(temporaryRoot, "AGENTS.md"),
  });

  const invalid = structuredClone(validReview);
  delete invalid.prompts.Story.Review;
  const response = await call(handler, "/api/finalized", {
    method: "POST",
    body: JSON.stringify(invalid),
  });
  assert.equal(response.status, 422);
  assert.match(JSON.parse(response.body).error, /Story · Review/);
});
