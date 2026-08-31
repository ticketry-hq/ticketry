import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  parsePublicUpdatePublisherArguments,
  PublicUpdatePublisherError,
  publishPublicUpdateRelease,
} from "./public-update-publisher.mjs";

const manifest = {
  release_version: "0.2.0",
  targets: [{ id: "macos-aarch64" }],
};

function response(status, payload = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function stageUpdateArtifacts({
  signed = true,
  notarized = true,
  archives = ["Ticketry.app.tar.gz"],
  signatures = ["Ticketry.app.tar.gz.sig"],
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "ticketry-public-update-"));
  const directory = path.join(root, "release-output", "0.2.0", "macos-aarch64");
  await mkdir(directory, { recursive: true });
  await Promise.all([
    ...archives.map((name) => writeFile(path.join(directory, name), `archive:${name}`)),
    ...signatures.map((name) => writeFile(path.join(directory, name), `signature:${name}`)),
    writeFile(path.join(directory, "release-metadata.json"), JSON.stringify({
      release_version: "0.2.0",
      target: "macos-aarch64",
      signed,
      notarized,
    })),
  ]);
  return root;
}

test("public update publisher CLI requires explicit release inputs", () => {
  assert.deepEqual(
    parsePublicUpdatePublisherArguments([
      "--target", "macos-aarch64",
      "--tag", "0.2.0",
      "--repository", "ticketry-hq/ticketry-updates",
      "--notes-file", "release-notes.md",
    ]),
    {
      targetId: "macos-aarch64",
      tag: "0.2.0",
      repository: "ticketry-hq/ticketry-updates",
      notesFile: "release-notes.md",
    },
  );
  assert.throws(
    () => parsePublicUpdatePublisherArguments([
      "--target", "macos-aarch64",
      "--tag", "0.2.0",
      "--repository", "ticketry-hq/ticketry-updates",
    ]),
    /--notes-file requires a release-notes path/,
  );
});

test("public update publisher refuses a destination other than the configured releases repository", async () => {
  let githubContacts = 0;

  await assert.rejects(
    publishPublicUpdateRelease({
      manifest,
      targetId: "macos-aarch64",
      tag: "0.2.0",
      repository: "ticketry-hq/not-the-update-feed",
      configuredRepository: "ticketry-hq/ticketry-updates",
      token: "token",
      notes: "Security and reliability fixes.",
      verifyLocalTag: async () => true,
      fetchImpl: async () => {
        githubContacts += 1;
        throw new Error("unexpected GitHub contact");
      },
    }),
    PublicUpdatePublisherError,
  );

  assert.equal(githubContacts, 0);
});

test("public update publisher refuses repository visibility other than public", async () => {
  const root = await stageUpdateArtifacts();
  const requests = [];

  await assert.rejects(
    publishPublicUpdateRelease({
      manifest,
      targetId: "macos-aarch64",
      tag: "0.2.0",
      repository: "ticketry-hq/ticketry-updates",
      configuredRepository: "ticketry-hq/ticketry-updates",
      token: "token",
      notes: "Security and reliability fixes.",
      root,
      verifyLocalTag: async () => true,
      fetchImpl: async (url, options = {}) => {
        requests.push({ url, options });
        return response(200, { private: true, visibility: "private" });
      },
    }),
    /visibility is not public/,
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.github.com/repos/ticketry-hq/ticketry-updates");
});

test("public update publisher refuses staged metadata unless signed and notarized", async () => {
  for (const metadata of [
    { signed: false, notarized: true },
    { signed: true, notarized: false },
  ]) {
    const root = await stageUpdateArtifacts(metadata);
    let githubContacts = 0;

    await assert.rejects(
      publishPublicUpdateRelease({
        manifest,
        targetId: "macos-aarch64",
        tag: "0.2.0",
        repository: "ticketry-hq/ticketry-updates",
        configuredRepository: "ticketry-hq/ticketry-updates",
        token: "token",
        notes: "Security and reliability fixes.",
        root,
        verifyLocalTag: async () => true,
        fetchImpl: async () => {
          githubContacts += 1;
          return response(200, { private: false, visibility: "public" });
        },
      }),
      /requires signed=true and notarized=true/,
    );

    assert.equal(githubContacts, 0);
  }
});

test("public update publisher requires exactly one update archive and its matching signature", async () => {
  const malformedStages = [
    { archives: [], signatures: ["Ticketry.app.tar.gz.sig"] },
    {
      archives: ["Ticketry.app.tar.gz", "Ticketry-preview.app.tar.gz"],
      signatures: ["Ticketry.app.tar.gz.sig"],
    },
    { archives: ["Ticketry.app.tar.gz"], signatures: [] },
    { archives: ["Ticketry.app.tar.gz"], signatures: ["Other.app.tar.gz.sig"] },
    {
      archives: ["Ticketry.app.tar.gz"],
      signatures: ["Ticketry.app.tar.gz.sig", "Other.app.tar.gz.sig"],
    },
  ];

  for (const stagedFiles of malformedStages) {
    const root = await stageUpdateArtifacts(stagedFiles);
    let githubContacts = 0;

    await assert.rejects(
      publishPublicUpdateRelease({
        manifest,
        targetId: "macos-aarch64",
        tag: "0.2.0",
        repository: "ticketry-hq/ticketry-updates",
        configuredRepository: "ticketry-hq/ticketry-updates",
        token: "token",
        notes: "Security and reliability fixes.",
        root,
        verifyLocalTag: async () => true,
        fetchImpl: async () => {
          githubContacts += 1;
          return response(200, { private: false, visibility: "public" });
        },
      }),
      /exactly one staged \.app\.tar\.gz and its matching \.sig/,
    );

    assert.equal(githubContacts, 0);
  }
});

test("public update publisher creates a stable release with archive, signature, and generated latest.json", async () => {
  const root = await stageUpdateArtifacts();
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === "https://api.github.com/repos/ticketry-hq/ticketry-updates") {
      return response(200, { private: false, visibility: "public" });
    }
    if (url.endsWith("/releases/tags/0.2.0")) {
      return response(404, { message: "Not Found" });
    }
    if (url.endsWith("/releases") && options.method === "POST") {
      return response(201, { id: 42 });
    }
    if (url.includes("uploads.github.com")) {
      return response(201, { state: "uploaded" });
    }
    if (url.endsWith("/releases/42") && options.method === "PATCH") {
      return response(200, { draft: false, prerelease: false });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  const result = await publishPublicUpdateRelease({
    manifest,
    targetId: "macos-aarch64",
    tag: "0.2.0",
    repository: "ticketry-hq/ticketry-updates",
    configuredRepository: "ticketry-hq/ticketry-updates",
    token: "secret-token-value",
    notes: "Security and reliability fixes.",
    publishedAt: new Date("2026-08-31T12:34:56.000Z"),
    root,
    verifyLocalTag: async () => true,
    fetchImpl,
  });

  assert.deepEqual(result.assets, [
    "Ticketry.app.tar.gz",
    "Ticketry.app.tar.gz.sig",
    "latest.json",
  ]);
  const uploads = requests.filter(({ url }) => url.includes("uploads.github.com"));
  assert.equal(uploads.length, 3);

  const latestUpload = uploads.find(({ url }) => url.endsWith("?name=latest.json"));
  const latest = JSON.parse(Buffer.from(latestUpload.options.body).toString("utf8"));
  assert.deepEqual(latest, {
    version: "0.2.0",
    notes: "Security and reliability fixes.",
    pub_date: "2026-08-31T12:34:56.000Z",
    platforms: {
      "darwin-aarch64": {
        signature: "signature:Ticketry.app.tar.gz.sig",
        url: "https://github.com/ticketry-hq/ticketry-updates/releases/download/0.2.0/Ticketry.app.tar.gz",
      },
    },
  });

  const creation = requests.find(({ url, options }) =>
    url.endsWith("/releases") && options.method === "POST");
  assert.deepEqual(JSON.parse(creation.options.body), {
    tag_name: "0.2.0",
    name: "Ticketry 0.2.0",
    body: "Security and reliability fixes.",
    draft: true,
    prerelease: false,
  });
  const publication = requests.find(({ url, options }) =>
    url.endsWith("/releases/42") && options.method === "PATCH");
  assert.deepEqual(JSON.parse(publication.options.body), {
    draft: false,
    prerelease: false,
  });
  assert.equal(
    requests.every(({ options }) => !String(options.body ?? "").includes("secret-token-value")),
    true,
  );
});
