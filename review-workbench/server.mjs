import { createServer } from "node:http";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number.parseInt(process.env.TICKETRY_REVIEW_PORT ?? "4174", 10);
const host = "127.0.0.1";
const bodyLimit = 2 * 1024 * 1024;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function json(response, status, body) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function validateReview(value) {
  if (!value || typeof value !== "object") return "Expected a JSON object.";
  if (value.schemaVersion !== 1) return "Unsupported review schema.";
  if (typeof value.agentsMd !== "string" || !value.agentsMd.trim()) {
    return "AGENTS.md cannot be empty.";
  }
  if (!value.prompts || typeof value.prompts !== "object") {
    return "Prompt matrix is missing.";
  }
  for (const type of ["Story", "PathFind", "Implementation"]) {
    if (!value.prompts[type] || typeof value.prompts[type] !== "object") {
      return `Prompt matrix is missing ${type}.`;
    }
    for (const state of [
      "Idea",
      "Refinement",
      "Ready",
      "Implement",
      "Review",
      "Done",
      "Cancelled",
    ]) {
      if (typeof value.prompts[type][state] !== "string") {
        return `Prompt matrix is missing ${type} · ${state}.`;
      }
    }
  }
  return null;
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > bodyLimit) throw new Error("Review payload is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function serveStatic(pathname, response, staticRoot) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const normalized = normalize(requested);
  if (normalized.startsWith("..") || normalized.includes("\0")) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  const path = join(staticRoot, normalized);
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) throw new Error("Not a file");
    const body = await readFile(path);
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": contentTypes[extname(path)] ?? "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

export function createReviewHandler({
  staticRoot = root,
  finalizedPath = join(root, "review-output.json"),
  productionDefaultsPath = join(
    root,
    "..",
    "backend",
    "worktracker",
    "reviewed_defaults.json",
  ),
  agentsPath = join(root, "..", "AGENTS.md"),
} = {}) {
  const outputPath = resolve(finalizedPath);
  const temporaryOutputPath = `${outputPath}.tmp`;
  const reviewedDefaultsPath = resolve(productionDefaultsPath);
  const temporaryReviewedDefaultsPath = `${reviewedDefaultsPath}.tmp`;
  const repositoryAgentsPath = resolve(agentsPath);
  const temporaryAgentsPath = `${repositoryAgentsPath}.tmp`;
  return async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${host}:${port}`);
      if (url.pathname === "/api/health" && request.method === "GET") {
        json(response, 200, { ok: true });
        return;
      }
      if (url.pathname === "/api/finalized" && request.method === "GET") {
        try {
          const review = JSON.parse(await readFile(outputPath, "utf8"));
          json(response, 200, { review });
        } catch (error) {
          if (error?.code === "ENOENT") {
            json(response, 200, { review: null });
            return;
          }
          throw error;
        }
        return;
      }
      if (url.pathname === "/api/finalized" && request.method === "POST") {
        const review = JSON.parse(await readBody(request));
        const validationError = validateReview(review);
        if (validationError) {
          json(response, 422, { error: validationError });
          return;
        }
        const serialized = `${JSON.stringify(review, null, 2)}\n`;
        const serializedAgents = `${review.agentsMd.trimEnd()}\n`;
        await writeFile(temporaryOutputPath, serialized, "utf8");
        await writeFile(temporaryReviewedDefaultsPath, serialized, "utf8");
        await writeFile(temporaryAgentsPath, serializedAgents, "utf8");
        await rename(temporaryOutputPath, outputPath);
        await rename(temporaryReviewedDefaultsPath, reviewedDefaultsPath);
        await rename(temporaryAgentsPath, repositoryAgentsPath);
        json(response, 200, {
          ok: true,
          savedAs: "Ticketry production defaults",
        });
        return;
      }
      await serveStatic(url.pathname, response, staticRoot);
    } catch (error) {
      json(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

export function createReviewServer(options) {
  return createServer(createReviewHandler(options));
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const server = createReviewServer();
  server.listen(port, host, () => {
    console.log(`Ticketry final review: http://${host}:${port}`);
  });
}
