import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReleaseNotes,
  GitHubReleasePublisherError,
  publishGitHubRelease,
} from "./github-release-publisher.mjs";
import { parseArguments, ReleasePublicationError, publishRelease } from "./release-publish.mjs";

const manifest = {
  release_version: "0.1.0",
  targets: [{
    id: "macos-aarch64",
    compatibility: {
      minimum_os: "11.0",
      tmux: "external-prerequisite",
    },
  }],
};
const targets = [{ id: "macos-aarch64" }, { id: "macos-x86_64" }];

test("publication runs installed-artifact acceptance for every supported target first", async () => {
  const calls = [];
  await publishRelease({
    manifest,
    targets,
    driverPath: "/opt/acceptance-driver",
    publishCommand: ["/opt/publisher", "upload"],
    readMetadata: async () => ({ signed: true, notarized: true }),
    accept: async ({ bundlePath, driverPath }) => calls.push(["accept", bundlePath, driverPath]),
    execute: async (command, args) => calls.push(["publish", command, ...args]),
  });
  assert.equal(calls.filter(([kind]) => kind === "accept").length, 2);
  assert.deepEqual(calls.at(-1), ["publish", "/opt/publisher", "upload"]);
});

test("publication fails closed when acceptance fails", async () => {
  const calls = [];
  await assert.rejects(
    publishRelease({
      manifest,
      targets: [targets[0]],
      driverPath: "/opt/acceptance-driver",
      publishCommand: ["/opt/publisher", "upload"],
      readMetadata: async () => ({ signed: true, notarized: true }),
      accept: async () => { throw new Error("durable flow failed"); },
      execute: async () => calls.push("published"),
    }),
    /durable flow failed/,
  );
  assert.deepEqual(calls, []);
});

test("publication cannot run without an explicit publisher", async () => {
  await assert.rejects(
    publishRelease({ manifest, targets: [], driverPath: "/driver", publishCommand: [] }),
    ReleasePublicationError,
  );
});

test("publication refuses unsigned or missing signing status without explicit acknowledgement", async () => {
  const calls = [];
  const options = {
    manifest,
    targets: [targets[0]],
    driverPath: "/opt/acceptance-driver",
    publishCommand: ["/opt/publisher", "upload"],
    accept: async () => calls.push("accepted"),
    execute: async () => calls.push("published"),
  };

  await assert.rejects(
    publishRelease({
      ...options,
      readMetadata: async () => ({}),
    }),
    /must explicitly declare signed and notarized booleans/,
  );
  await assert.rejects(
    publishRelease({
      ...options,
      readMetadata: async () => ({ signed: false, notarized: false }),
    }),
    /refusing to publish unsigned artifact.*--acknowledge-unsigned/,
  );
  assert.deepEqual(calls, []);
});

test("publication accepts an unsigned artifact only with separate explicit acknowledgement", async () => {
  const calls = [];
  await publishRelease({
    manifest,
    targets: [targets[0]],
    driverPath: "/opt/acceptance-driver",
    publishCommand: ["/opt/publisher", "upload"],
    acknowledgeUnsigned: true,
    readMetadata: async () => ({ signed: false, notarized: false }),
    accept: async () => calls.push("accepted"),
    execute: async () => calls.push("published"),
  });
  assert.deepEqual(calls, ["accepted", "published"]);
  assert.deepEqual(parseArguments(["--target", "macos-aarch64", "--acknowledge-unsigned"]), {
    requestedTarget: "macos-aarch64",
    acknowledgeUnsigned: true,
  });
});

test("publication rejects inconsistent signing metadata even when unsigned publication is acknowledged", async () => {
  await assert.rejects(
    publishRelease({
      manifest,
      targets: [targets[0]],
      driverPath: "/opt/acceptance-driver",
      publishCommand: ["/opt/publisher", "upload"],
      acknowledgeUnsigned: true,
      readMetadata: async () => ({ signed: true, notarized: false }),
    }),
    /inconsistent signing status/,
  );
});

function response(status, payload = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const stagedAssets = [
  {
    name: "Ticketry_0.1.0_aarch64.dmg",
    content: Buffer.from("dmg-content"),
    contentType: "application/x-apple-diskimage",
    digest: "a".repeat(64),
  },
  {
    name: "release-metadata.json",
    content: Buffer.from('{"signed":false,"notarized":false}'),
    contentType: "application/json",
    digest: "b".repeat(64),
  },
];

test("GitHub publisher creates a private release with staged assets, digests, and recipient instructions", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === "https://api.github.com/repos/ticketry-hq/private-ticketry") {
      return response(200, { private: true });
    }
    if (url.endsWith("/git/ref/tags/0.1.0")) return response(200, { ref: "refs/tags/0.1.0" });
    if (url.endsWith("/releases/tags/0.1.0")) return response(404, { message: "Not Found" });
    if (url.endsWith("/releases") && options.method === "POST") return response(201, { id: 42 });
    if (url.includes("uploads.github.com")) return response(201, { state: "uploaded" });
    if (url.endsWith("/releases/42") && options.method === "PATCH") {
      return response(200, { draft: false });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  const result = await publishGitHubRelease({
    manifest,
    targetId: "macos-aarch64",
    tag: "0.1.0",
    repository: "ticketry-hq/private-ticketry",
    token: "secret-token-value",
    fetchImpl,
    verifyLocalTag: async () => true,
    readAssets: async () => stagedAssets,
  });

  assert.deepEqual(result.assets, stagedAssets.map(({ name, digest }) => ({ name, digest })));
  assert.equal(requests.filter(({ url }) => url.includes("uploads.github.com")).length, 2);
  const creation = requests.find(({ url, options }) =>
    url.endsWith("/releases") && options.method === "POST");
  const release = JSON.parse(creation.options.body);
  assert.equal(release.draft, true);
  assert.match(release.body, /unsigned and not notarized/);
  assert.match(release.body, /Minimum macOS version: \*\*11\.0\*\*/);
  assert.match(release.body, /External prerequisite: \*\*tmux\*\*/);
  assert.match(release.body, /System Settings → Privacy & Security/);
  assert.match(release.body, /Open Anyway/);
  assert.match(release.body, /sudo \/usr\/bin\/xattr -dr com\.apple\.quarantine/);
  assert.match(release.body, new RegExp(`a{64}  Ticketry_0\\.1\\.0_aarch64\\.dmg`));
  assert.match(release.body, new RegExp(`b{64}  release-metadata\\.json`));
  assert.equal(
    requests.every(({ options }) => !String(options.body ?? "").includes("secret-token-value")),
    true,
  );
  assert.equal(
    requests.every(({ options }) => options.headers.Authorization === "Bearer secret-token-value"),
    true,
  );
});

test("GitHub publisher refuses an existing release rather than replacing assets", async () => {
  const requests = [];
  await assert.rejects(
    publishGitHubRelease({
      manifest,
      targetId: "macos-aarch64",
      tag: "0.1.0",
      repository: "ticketry-hq/private-ticketry",
      token: "token",
      verifyLocalTag: async () => true,
      readAssets: async () => stagedAssets,
      fetchImpl: async (url) => {
        requests.push(url);
        if (url.endsWith("/private-ticketry")) return response(200, { private: true });
        if (url.endsWith("/git/ref/tags/0.1.0")) return response(200, {});
        if (url.endsWith("/releases/tags/0.1.0")) return response(200, { id: 41 });
        throw new Error(`unexpected request: ${url}`);
      },
    }),
    /already exists; refusing to overwrite/,
  );
  assert.equal(requests.some((url) => url.includes("uploads.github.com")), false);
});

test("missing or mismatched local tags fail before any GitHub contact", async () => {
  for (const [tag, tagExists, expected] of [
    ["0.1.1", true, /does not match release_version/],
    ["0.1.0", false, /local version tag "0.1.0" does not exist/],
  ]) {
    let contacts = 0;
    await assert.rejects(
      publishGitHubRelease({
        manifest,
        targetId: "macos-aarch64",
        tag,
        repository: "ticketry-hq/private-ticketry",
        token: "token",
        verifyLocalTag: async () => tagExists,
        readAssets: async () => stagedAssets,
        fetchImpl: async () => {
          contacts += 1;
          return response(500);
        },
      }),
      expected,
    );
    assert.equal(contacts, 0);
  }
});

test("publisher refuses a missing remote tag before creating a release", async () => {
  const requests = [];
  await assert.rejects(
    publishGitHubRelease({
      manifest,
      targetId: "macos-aarch64",
      tag: "0.1.0",
      repository: "ticketry-hq/private-ticketry",
      token: "token",
      verifyLocalTag: async () => true,
      readAssets: async () => stagedAssets,
      fetchImpl: async (url, options = {}) => {
        requests.push({ url, options });
        if (url.endsWith("/private-ticketry")) return response(200, { private: true });
        if (url.endsWith("/git/ref/tags/0.1.0")) return response(404, { message: "Not Found" });
        throw new Error(`unexpected request: ${url}`);
      },
    }),
    /remote version tag "0.1.0" does not exist/,
  );
  assert.equal(
    requests.some(({ url, options }) => url.endsWith("/releases") && options.method === "POST"),
    false,
  );
});

test("publisher refuses a public repository and never places the token in release notes", async () => {
  const notes = buildReleaseNotes(manifest, manifest.targets[0], stagedAssets);
  assert.doesNotMatch(notes, /secret-token-value/);
  await assert.rejects(
    publishGitHubRelease({
      manifest,
      targetId: "macos-aarch64",
      tag: "0.1.0",
      repository: "ticketry-hq/public-ticketry",
      token: "secret-token-value",
      verifyLocalTag: async () => true,
      readAssets: async () => stagedAssets,
      fetchImpl: async () => response(200, { private: false }),
    }),
    GitHubReleasePublisherError,
  );
});
