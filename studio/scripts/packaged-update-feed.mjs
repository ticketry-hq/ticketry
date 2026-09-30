import { readFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";

const DOWNLOAD_PATH = "/releases/latest/download";

export class PackagedUpdateFeedError extends Error {}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PackagedUpdateFeedError(`${label} is required`);
  }
  return value;
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host, port }, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

export async function startPackagedUpdateFeed({
  origin,
  port,
  tls,
  archivePath,
  signaturePath,
  release,
}) {
  const declaredOrigin = new URL(requireText(origin, "origin"));
  if (declaredOrigin.protocol !== "https:") {
    throw new PackagedUpdateFeedError("feed origin must use HTTPS");
  }
  const [key, certificate, archive, signatureBytes] = await Promise.all([
    readFile(requireText(tls?.keyPath, "TLS key path")),
    readFile(requireText(tls?.certificatePath, "TLS certificate path")),
    readFile(requireText(archivePath, "archive path")),
    readFile(requireText(signaturePath, "signature path")),
  ]);
  const signature = signatureBytes.toString("utf8").trim();
  requireText(signature, "updater signature");
  const requests = [];
  let liveOrigin;
  const archiveName = path.basename(archivePath);
  const archiveRoute = `${DOWNLOAD_PATH}/${archiveName}`;
  const signatureRoute = `${archiveRoute}.sig`;
  const latestRoute = `${DOWNLOAD_PATH}/latest.json`;
  const server = https.createServer({ key, cert: certificate }, (request, response) => {
    const pathname = new URL(request.url ?? "/", liveOrigin).pathname;
    requests.push({ method: request.method ?? "GET", pathname });
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET" });
      response.end();
      return;
    }
    if (pathname === archiveRoute) {
      response.writeHead(200, { "Content-Type": "application/gzip" });
      response.end(archive);
      return;
    }
    if (pathname === signatureRoute) {
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(signatureBytes);
      return;
    }
    if (pathname === latestRoute) {
      const latest = {
        version: requireText(release?.version, "release version"),
        notes: requireText(release?.notes, "release notes"),
        pub_date: requireText(release?.publishedAt, "publication date"),
        platforms: {
          "darwin-aarch64": {
            signature,
            url: `${liveOrigin}${archiveRoute}`,
          },
        },
      };
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(`${JSON.stringify(latest, null, 2)}\n`);
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found\n");
  });
  await listen(server, declaredOrigin.hostname, port);
  const address = server.address();
  if (!address || typeof address === "string") {
    await close(server);
    throw new PackagedUpdateFeedError("could not determine HTTPS feed address");
  }
  liveOrigin = `${declaredOrigin.protocol}//${declaredOrigin.hostname}:${address.port}`;
  return {
    origin: liveOrigin,
    requests,
    close: () => close(server),
    dispose: () => close(server),
  };
}
