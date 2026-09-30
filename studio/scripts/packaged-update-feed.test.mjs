import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { startPackagedUpdateFeed } from "./packaged-update-feed.mjs";

const execFileAsync = promisify(execFile);
const DOWNLOAD_PATH = "/releases/latest/download";
const ARCHIVE_NAME = "Ticketry.app.tar.gz";

async function createFeedFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "ticketry-packaged-update-feed-"));
  const archivePath = path.join(root, ARCHIVE_NAME);
  const signaturePath = `${archivePath}.sig`;
  const keyPath = path.join(root, "localhost.key.pem");
  const certificatePath = path.join(root, "localhost.cert.pem");
  const archive = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x54, 0x49, 0x43, 0x4b]);
  const signature = "test updater signature from the .sig file\n";

  await Promise.all([
    writeFile(archivePath, archive),
    writeFile(signaturePath, signature),
    execFileAsync("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certificatePath,
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-days",
      "1",
    ]),
  ]);

  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    archive,
    archivePath,
    certificatePath,
    keyPath,
    signature,
    signaturePath,
  };
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: options.method ?? "GET",
      rejectUnauthorized: false,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        body: Buffer.concat(chunks),
        headers: response.headers,
        status: response.statusCode,
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function startFeed(t, fixture, overrides = {}) {
  const feed = await startPackagedUpdateFeed({
    origin: "https://127.0.0.1",
    port: 0,
    tls: {
      keyPath: fixture.keyPath,
      certificatePath: fixture.certificatePath,
    },
    archivePath: fixture.archivePath,
    signaturePath: fixture.signaturePath,
    release: {
      version: "1.5.0",
      notes: "Packaged updater acceptance release.",
      publishedAt: "2026-09-04T09:30:00.000Z",
    },
    ...overrides,
  });
  t.after(() => feed.close());
  return feed;
}

test("serves latest.json, the archive, and its signature at the production download paths", async (t) => {
  const fixture = await createFeedFixture(t);
  const feed = await startFeed(t, fixture);
  const latestUrl = `${feed.origin}${DOWNLOAD_PATH}/latest.json`;
  const archiveUrl = `${feed.origin}${DOWNLOAD_PATH}/${ARCHIVE_NAME}`;
  const signatureUrl = `${archiveUrl}.sig`;

  assert.equal(new URL(feed.origin).protocol, "https:");

  const [latestResponse, archiveResponse, signatureResponse] = await Promise.all([
    request(latestUrl),
    request(archiveUrl),
    request(signatureUrl),
  ]);

  assert.equal(latestResponse.status, 200);
  assert.match(latestResponse.headers["content-type"], /^application\/json\b/);
  assert.deepEqual(JSON.parse(latestResponse.body.toString("utf8")), {
    version: "1.5.0",
    notes: "Packaged updater acceptance release.",
    pub_date: "2026-09-04T09:30:00.000Z",
    platforms: {
      "darwin-aarch64": {
        signature: fixture.signature.trim(),
        url: archiveUrl,
      },
    },
  });

  assert.equal(archiveResponse.status, 200);
  assert.deepEqual(archiveResponse.body, fixture.archive);
  assert.equal(signatureResponse.status, 200);
  assert.equal(signatureResponse.body.toString("utf8"), fixture.signature);
});

test("rejects every non-feed path and records accepted and rejected requests", async (t) => {
  const fixture = await createFeedFixture(t);
  const feed = await startFeed(t, fixture);
  const requestedPaths = [
    `${DOWNLOAD_PATH}/latest.json`,
    `${DOWNLOAD_PATH}/${ARCHIVE_NAME}`,
    `${DOWNLOAD_PATH}/${ARCHIVE_NAME}.sig`,
    "/latest.json",
    `${DOWNLOAD_PATH}/other.tar.gz`,
    `${DOWNLOAD_PATH}/latest.json/`,
  ];

  const responses = [];
  for (const pathname of requestedPaths) {
    responses.push(await request(`${feed.origin}${pathname}`));
  }

  assert.deepEqual(responses.map(({ status }) => status), [200, 200, 200, 404, 404, 404]);
  assert.deepEqual(feed.requests, requestedPaths.map((pathname) => ({
    method: "GET",
    pathname,
  })));
});

test("refuses to start when the declared origin is not HTTPS", async (t) => {
  const fixture = await createFeedFixture(t);

  await assert.rejects(
    startPackagedUpdateFeed({
      origin: "http://127.0.0.1",
      port: 0,
      tls: {
        keyPath: fixture.keyPath,
        certificatePath: fixture.certificatePath,
      },
      archivePath: fixture.archivePath,
      signaturePath: fixture.signaturePath,
      release: {
        version: "1.5.0",
        notes: "Packaged updater acceptance release.",
        publishedAt: "2026-09-04T09:30:00.000Z",
      },
    }),
    /origin must use HTTPS/i,
  );
});
