const endpoint = "/__ticketry/frontend-log";
const allowedLevels = new Set(["debug", "info", "warn", "error"]);
const maxRequestBytes = 64 * 1024;
const maxMessageCharacters = 16 * 1024;

export const webFrontendLogEndpoint = endpoint;

export function formatWebFrontendLogPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (!allowedLevels.has(payload.level) || typeof payload.message !== "string") return null;
  const flattened = payload.message.replaceAll("\r", "\\r").replaceAll("\n", "\\n");
  const bounded = flattened.length > maxMessageCharacters
    ? `${flattened.slice(0, maxMessageCharacters)} [truncated]`
    : flattened;
  return `[frontend][${payload.level}] ${bounded}`;
}

async function readRequestBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes <= maxRequestBytes) chunks.push(chunk);
  }
  if (bytes > maxRequestBytes) return { tooLarge: true, body: "" };
  return { tooLarge: false, body: Buffer.concat(chunks).toString("utf8") };
}

function respond(response, status, body = "") {
  response.statusCode = status;
  response.setHeader("cache-control", "no-store");
  if (body) response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(body);
}

export function webFrontendLogPlugin({
  enabled = process.env.VITE_TICKETRY_WEB_FILE_LOGGING === "true",
  writeLine = (line) => process.stdout.write(`${line}\n`),
} = {}) {
  return {
    name: "ticketry-web-frontend-log",
    apply: "serve",
    configureServer(server) {
      if (!enabled) return;
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== endpoint) {
          next();
          return;
        }
        if (request.method !== "POST") {
          respond(response, 405, "POST is required");
          return;
        }
        try {
          const received = await readRequestBody(request);
          if (received.tooLarge) {
            respond(response, 413, "frontend log record is too large");
            return;
          }
          const line = formatWebFrontendLogPayload(JSON.parse(received.body));
          if (!line) {
            respond(response, 400, "invalid frontend log record");
            return;
          }
          writeLine(line);
          respond(response, 204);
        } catch {
          respond(response, 400, "invalid frontend log record");
        }
      });
    },
  };
}

