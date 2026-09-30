import assert from "node:assert/strict";
import { get } from "node:https";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import {
  bundledUpdateAcceptanceDriverPath,
  generateLoopbackCertificate,
  REQUIRED_UPDATE_CASES,
  UPDATE_FEED_CASES,
  UpdateAcceptanceError,
  assertUpdateAcceptanceResult,
  feedAssetPath,
  feedCaseArtifacts,
  mergeUpdateAcceptanceResults,
  parseUpdateAcceptanceArguments,
  preservedDataEntries,
  startLocalUpdateFeed,
  tamperedArchive,
  updateAcceptanceEnvironment,
  updateFeedManifest,
} from "./update-acceptance.mjs";

const SIGNED_ARCHIVE = Buffer.from("ticketry-0.3.0-archive-bytes");

/**
 * Reads one feed asset without consulting the platform trust store.
 *
 * A real run trusts the throwaway certificate for its duration; this test only
 * needs to prove what the feed serves, so it skips that side effect.
 */
function fetchIgnoringLocalTrust(url) {
  return new Promise((resolve, reject) => {
    get(url, { rejectUnauthorized: false }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    }).on("error", reject);
  });
}
const SIGNATURE = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQo=";

function passingResult() {
  return Object.fromEntries([
    ["updater_signature_verified", true],
    ...REQUIRED_UPDATE_CASES.map((caseName) => [caseName, true]),
  ]);
}

test("acceptance arguments require both versions and an absolute driver", () => {
  assert.deepEqual(
    parseUpdateAcceptanceArguments([
      "--from", "/tmp/a/Ticketry.app",
      "--to", "/tmp/b",
      "--to-version", "0.3.0",
    ]),
    { fromBundle: "/tmp/a/Ticketry.app", toBundle: "/tmp/b", toVersion: "0.3.0" },
  );
  assert.throws(
    () => parseUpdateAcceptanceArguments(["--to", "/tmp/b", "--to-version", "0.3.0"]),
    UpdateAcceptanceError,
  );
  assert.throws(
    () => parseUpdateAcceptanceArguments(["--from", "/tmp/a", "--to", "/tmp/b", "--to-version", "0.3.0", "--driver", "driver"]),
    /--driver must be an absolute path/,
  );
  assert.throws(
    () => parseUpdateAcceptanceArguments(["--channel", "beta"]),
    /unknown update acceptance option/,
  );
});

test("the local feed serves the production latest.json shape and URL layout", () => {
  const manifest = updateFeedManifest({
    version: "0.3.0",
    notes: "Update acceptance build 0.3.0.",
    signature: SIGNATURE,
    archiveName: "Ticketry.app.tar.gz",
    feedOrigin: "https://localhost:52001/",
    publishedAt: new Date("2026-08-31T00:00:00.000Z"),
  });

  assert.deepEqual(manifest, {
    version: "0.3.0",
    notes: "Update acceptance build 0.3.0.",
    pub_date: "2026-08-31T00:00:00.000Z",
    platforms: {
      "darwin-aarch64": {
        signature: SIGNATURE,
        url: "https://localhost:52001/releases/latest/download/Ticketry.app.tar.gz",
      },
    },
  });
  assert.equal(feedAssetPath("latest.json"), "/releases/latest/download/latest.json");
});

test("the feed manifest refuses missing notes, missing signatures, and plain HTTP", () => {
  const valid = {
    version: "0.3.0",
    notes: "Update acceptance build 0.3.0.",
    signature: SIGNATURE,
    archiveName: "Ticketry.app.tar.gz",
    feedOrigin: "https://localhost:52001/",
    publishedAt: new Date("2026-08-31T00:00:00.000Z"),
  };
  for (const [override, expected] of [
    [{ notes: "  " }, /release notes/],
    [{ signature: "" }, /updater signature/],
    [{ archiveName: "Ticketry.dmg" }, /\.app\.tar\.gz/],
    [{ feedOrigin: "http://localhost:52001/" }, /HTTPS/],
    [{ publishedAt: "not a date" }, /publication date/],
  ]) {
    assert.throws(() => updateFeedManifest({ ...valid, ...override }), expected);
  }
});

test("tampering changes the signed bytes without changing the archive length", () => {
  const tampered = tamperedArchive(SIGNED_ARCHIVE);

  assert.equal(tampered.length, SIGNED_ARCHIVE.length);
  assert.notEqual(tampered.toString("hex"), SIGNED_ARCHIVE.toString("hex"));
  assert.throws(() => tamperedArchive(Buffer.alloc(0)), UpdateAcceptanceError);
});

test("each refusal case serves exactly what makes it fail", () => {
  const signed = feedCaseArtifacts({
    feedCase: "signed",
    archive: SIGNED_ARCHIVE,
    signature: SIGNATURE,
  });
  assert.equal(signed.archive, SIGNED_ARCHIVE);
  assert.equal(signed.signature, SIGNATURE);

  const tampered = feedCaseArtifacts({
    feedCase: "tampered",
    archive: SIGNED_ARCHIVE,
    signature: SIGNATURE,
  });
  assert.equal(tampered.signature, SIGNATURE);
  assert.notEqual(tampered.archive.toString("hex"), SIGNED_ARCHIVE.toString("hex"));

  const wrongKey = feedCaseArtifacts({
    feedCase: "wrong-key",
    archive: SIGNED_ARCHIVE,
    signature: SIGNATURE,
    wrongKeySignature: "dW50cnVzdGVkIGNvbW1lbnQ6IG90aGVyCg==",
  });
  assert.equal(wrongKey.archive, SIGNED_ARCHIVE);
  assert.equal(wrongKey.signature, "dW50cnVzdGVkIGNvbW1lbnQ6IG90aGVyCg==");

  assert.throws(
    () => feedCaseArtifacts({ feedCase: "wrong-key", archive: SIGNED_ARCHIVE, signature: SIGNATURE }),
    /second throwaway key/,
  );
  assert.throws(
    () => feedCaseArtifacts({ feedCase: "unsigned", archive: SIGNED_ARCHIVE, signature: SIGNATURE }),
    /unknown update feed case/,
  );
  assert.deepEqual(UPDATE_FEED_CASES, ["signed", "tampered", "wrong-key", "unreachable"]);
});

test("the harness ships an absolute default driver", () => {
  assert.equal(path.isAbsolute(bundledUpdateAcceptanceDriverPath), true);
  assert.equal(
    path.basename(bundledUpdateAcceptanceDriverPath),
    "update-acceptance-driver",
  );
});

test("the update run keeps the app alive past startup", () => {
  const environment = updateAcceptanceEnvironment({
    home: "/tmp/run/home",
    dataDirectory: "/tmp/run/home/.config/ticketry",
    resultPath: "/tmp/run/update-result.json",
    feedUrl: "https://localhost:52001/releases/latest/download/latest.json",
    expectedVersion: "0.3.0",
  });

  // The installed-artifact run exits after startup; an update needs the app to
  // reach the install, so that switch must not survive into this environment.
  assert.equal("MUXED_DESKTOP_ACCEPTANCE_EXIT_AFTER_STARTUP" in environment, false);
  assert.equal(environment.TICKETRY_UPDATE_ACCEPTANCE_CASE, undefined);
  assert.ok(environment.MUXED_DESKTOP_ACCEPTANCE_NODE);
});

test("the acceptance environment overrides the feed without weakening the run", () => {
  const environment = updateAcceptanceEnvironment({
    home: "/tmp/run/home",
    dataDirectory: "/tmp/run/home/.config/ticketry",
    resultPath: "/tmp/run/update-result.json",
    feedUrl: "https://localhost:52001/releases/latest/download/latest.json",
    expectedVersion: "0.3.0",
  });

  assert.equal(
    environment.TICKETRY_UPDATE_FEED_URL,
    "https://localhost:52001/releases/latest/download/latest.json",
  );
  assert.equal(environment.TICKETRY_UPDATE_ACCEPTANCE_EXPECTED_VERSION, "0.3.0");
  assert.equal(environment.MUXED_DATA_DIR, "/tmp/run/home/.config/ticketry");
  // The sanitized desktop environment stays in force, so the run cannot reach
  // the real network or the developer's own data directory.
  assert.equal(environment.HTTPS_PROXY, "http://127.0.0.1:1");
  assert.equal(environment.HOME, "/tmp/run/home");
  assert.equal(
    Object.keys(environment).some((key) => /DANGER|INSECURE|SKIP/i.test(key)),
    false,
  );
  assert.throws(
    () => updateAcceptanceEnvironment({
      home: "/tmp/run/home",
      dataDirectory: "/tmp/run/data",
      resultPath: "/tmp/run/result.json",
      feedUrl: "http://localhost:52001/releases/latest/download/latest.json",
      expectedVersion: "0.3.0",
    }),
    /must use HTTPS/,
  );
});

test("acceptance requires every discovery, preservation, and refusal case", () => {
  assert.doesNotThrow(() => assertUpdateAcceptanceResult(passingResult()));
  for (const caseName of REQUIRED_UPDATE_CASES) {
    assert.throws(
      () => assertUpdateAcceptanceResult({ ...passingResult(), [caseName]: false }),
      new RegExp(caseName),
    );
  }
});

test("acceptance never passes with an unverified signature or a changed app", () => {
  assert.throws(
    () => assertUpdateAcceptanceResult({
      ...passingResult(),
      updater_signature_verified: false,
    }),
    /contract under test/,
  );
  assert.throws(
    () => assertUpdateAcceptanceResult({
      ...passingResult(),
      refused_installations_changed_the_app: true,
    }),
    /leave the running version unchanged/,
  );
  assert.throws(() => assertUpdateAcceptanceResult(null), UpdateAcceptanceError);
});

test("a failing case reports its redacted detail", () => {
  assert.throws(
    () => assertUpdateAcceptanceResult({
      ...passingResult(),
      no_stranded_processes: false,
      case_failures: { no_stranded_processes: "one sidecar survived the relaunch" },
    }),
    /no_stranded_processes \(one sidecar survived the relaunch\)/,
  );
  assert.throws(
    () => assertUpdateAcceptanceResult({
      ...passingResult(),
      no_stranded_processes: false,
      case_failures: { no_stranded_processes: "token: abcd1234" },
    }),
    /^(?!.*abcd1234).*no_stranded_processes/s,
  );
});

test("case runs merge into one result and each case must appear", () => {
  const merged = mergeUpdateAcceptanceResults([
    {
      updater_signature_verified: true,
      discovered_available_version: true,
      installed_on_confirmation: true,
      relaunched_into_new_version: true,
      work_tracker_data_preserved: true,
      selected_workspace_restored: true,
      approved_paths_and_preferences_preserved: true,
      data_directory_lock_released_and_reacquired: true,
      no_stranded_processes: true,
      tampered_archive_refused: false,
    },
    { tampered_archive_refused: true, version_a_healthy_after_refusal: true },
    { wrong_key_signature_refused: true },
    { unreachable_feed_retryable: true },
  ]);

  assert.doesNotThrow(() => assertUpdateAcceptanceResult(merged));
  assert.throws(
    () => assertUpdateAcceptanceResult(
      mergeUpdateAcceptanceResults([{ updater_signature_verified: true }]),
    ),
    /discovered_available_version/,
  );
  assert.throws(() => mergeUpdateAcceptanceResults([]), UpdateAcceptanceError);
});

test("a refusal anywhere that changed the app fails the merged run", () => {
  const merged = mergeUpdateAcceptanceResults([
    passingResult(),
    { refused_installations_changed_the_app: true },
  ]);

  assert.throws(
    () => assertUpdateAcceptanceResult(merged),
    /leave the running version unchanged/,
  );
});

test("preserved data comes from the release manifest, not the test", () => {
  assert.deepEqual(
    preservedDataEntries({
      release_policy: { data: { preserve: ["WorkTracker data", "preferences"] } },
    }),
    ["WorkTracker data", "preferences"],
  );
  assert.throws(() => preservedDataEntries({}), /must declare the data an update preserves/);
});

test("the local feed serves latest.json and the archive over HTTPS, and 503s when unreachable", async () => {
  const directory = await mkdtemp("/tmp/ticketry-update-feed-cert-test-");
  const certificate = await generateLoopbackCertificate(directory);
  const feed = await startLocalUpdateFeed({
    manifestFor: (origin) => updateFeedManifest({
      version: "0.3.0",
      notes: "Update acceptance build 0.3.0.",
      signature: SIGNATURE,
      archiveName: "Ticketry.app.tar.gz",
      feedOrigin: origin,
      publishedAt: new Date("2026-08-31T00:00:00.000Z"),
    }),
    archiveName: "Ticketry.app.tar.gz",
    archive: SIGNED_ARCHIVE,
    certificate,
  });
  try {
    assert.match(feed.latestUrl, /^https:\/\/localhost:\d+\/releases\/latest\/download\/latest\.json$/);
    assert.equal(
      feed.manifest.platforms["darwin-aarch64"].url,
      new URL("releases/latest/download/Ticketry.app.tar.gz", feed.origin).href,
    );

    const served = await fetchIgnoringLocalTrust(feed.latestUrl);
    assert.equal(served.status, 200);
    assert.deepEqual(JSON.parse(served.body), feed.manifest);

    const archive = await fetchIgnoringLocalTrust(
      new URL(feedAssetPath("Ticketry.app.tar.gz"), feed.origin).href,
    );
    assert.equal(archive.status, 200);
    assert.equal(archive.body, SIGNED_ARCHIVE.toString());
    assert.deepEqual(feed.requests, [
      feedAssetPath("latest.json"),
      feedAssetPath("Ticketry.app.tar.gz"),
    ]);
  } finally {
    await feed.close();
  }

  const unreachable = await startLocalUpdateFeed({
    manifestFor: () => ({}),
    archiveName: "Ticketry.app.tar.gz",
    archive: SIGNED_ARCHIVE,
    certificate,
    unreachable: true,
  });
  try {
    const refused = await fetchIgnoringLocalTrust(unreachable.latestUrl);
    assert.equal(refused.status, 503);
  } finally {
    await unreachable.close();
    await rm(directory, { recursive: true, force: true });
  }
});
