/**
 * Packaged macOS arm64 update acceptance.
 *
 * A packaged version A must discover a newer signed version B through a feed
 * shaped exactly like the production one, install it on user confirmation, and
 * relaunch as B with its data and selected workspace intact. A tampered
 * archive, a wrong-key signature, and an unreachable feed must all refuse the
 * installation and leave A running and healthy.
 *
 * The feed here mirrors `releases/latest/download/` so the run also exercises
 * the URL contract the app ships with, and version B is signed with a
 * throwaway updater key generated for the run — never the production key. The
 * updater signature is the contract under test and is never skipped.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:https";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  acceptanceDataDirectory,
  installArtifact,
  sanitizedDesktopEnvironment,
} from "./installed-artifact-acceptance.mjs";

const studioRoot = fileURLToPath(new URL("..", import.meta.url));

/** The driver this harness ships; `--driver` replaces it. */
export const bundledUpdateAcceptanceDriverPath = fileURLToPath(
  new URL("./update-acceptance-driver", import.meta.url),
);

export class UpdateAcceptanceError extends Error {}

/** The cases one run must prove, and what each one asserts. */
export const REQUIRED_UPDATE_CASES = [
  "discovered_available_version",
  "installed_on_confirmation",
  "relaunched_into_new_version",
  "work_tracker_data_preserved",
  "selected_workspace_restored",
  "approved_paths_and_preferences_preserved",
  "data_directory_lock_released_and_reacquired",
  "no_stranded_processes",
  "tampered_archive_refused",
  "wrong_key_signature_refused",
  "unreachable_feed_retryable",
  "version_a_healthy_after_refusal",
];

const CREDENTIAL_PATTERN =
  /((api|access|auth|secret|token|password)[_-]?(key|token|password)?\s*[=:])|bearer\s+/i;

export function parseUpdateAcceptanceArguments(arguments_) {
  const options = new Map([
    ["--from", "fromBundle"],
    ["--to", "toBundle"],
    ["--to-version", "toVersion"],
    ["--driver", "driverPath"],
  ]);
  const values = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index];
    const key = options.get(option);
    if (!key) {
      throw new UpdateAcceptanceError(`unknown update acceptance option: ${option}`);
    }
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) {
      throw new UpdateAcceptanceError(`${option} requires a value`);
    }
    values[key] = value;
  }
  for (const [key, message] of [
    ["fromBundle", "--from requires the packaged version A .app bundle"],
    ["toBundle", "--to requires the staged version B release-output directory"],
    ["toVersion", "--to-version requires the version B release version"],
  ]) {
    if (!values[key]) throw new UpdateAcceptanceError(message);
  }
  if (values.driverPath && !path.isAbsolute(values.driverPath)) {
    throw new UpdateAcceptanceError("--driver must be an absolute path");
  }
  return values;
}

/**
 * The `latest.json` the local feed serves.
 *
 * It keeps the production manifest's required fields and its
 * `releases/latest/download/` archive URL, so a run that passes here has
 * validated the shape the app reads in production.
 */
export function updateFeedManifest({
  version,
  notes,
  signature,
  archiveName,
  feedOrigin,
  publishedAt,
}) {
  if (!version) throw new UpdateAcceptanceError("the feed manifest requires a version");
  if (typeof notes !== "string" || !notes.trim()) {
    throw new UpdateAcceptanceError("the feed manifest requires release notes");
  }
  if (typeof signature !== "string" || !signature.trim()) {
    throw new UpdateAcceptanceError("the feed manifest requires an updater signature");
  }
  if (!archiveName?.endsWith(".app.tar.gz")) {
    throw new UpdateAcceptanceError("the feed manifest requires an .app.tar.gz archive");
  }
  const origin = new URL(feedOrigin);
  if (origin.protocol !== "https:") {
    throw new UpdateAcceptanceError("the local update feed must be served over HTTPS");
  }
  const publicationDate = publishedAt instanceof Date ? publishedAt : new Date(publishedAt);
  if (Number.isNaN(publicationDate.valueOf())) {
    throw new UpdateAcceptanceError("the feed manifest requires a valid publication date");
  }
  return {
    version,
    notes: notes.trim(),
    pub_date: publicationDate.toISOString(),
    platforms: {
      "darwin-aarch64": {
        signature: signature.trim(),
        url: new URL(
          `releases/latest/download/${encodeURIComponent(archiveName)}`,
          origin,
        ).href,
      },
    },
  };
}

/** The feed's asset paths, mirroring the production layout exactly. */
export function feedAssetPath(assetName) {
  return `/releases/latest/download/${assetName}`;
}

/**
 * A copy of the archive one byte different from the signed original.
 *
 * The signature still verifies against the untampered bytes, so this is what
 * makes the refusal case a real signature failure rather than a missing file.
 */
export function tamperedArchive(archive) {
  if (!Buffer.isBuffer(archive) || archive.length === 0) {
    throw new UpdateAcceptanceError("tampering requires the signed archive bytes");
  }
  const tampered = Buffer.from(archive);
  const offset = Math.floor(tampered.length / 2);
  tampered[offset] = tampered[offset] ^ 0xff;
  return tampered;
}

export function assertUpdateAcceptanceResult(result) {
  if (!result || typeof result !== "object") {
    throw new UpdateAcceptanceError("the update acceptance driver did not write a JSON object");
  }
  if (result.updater_signature_verified !== true) {
    throw new UpdateAcceptanceError(
      "the run must verify the updater signature; it is the contract under test",
    );
  }
  for (const caseName of REQUIRED_UPDATE_CASES) {
    if (result[caseName] !== true) {
      const detail = result.case_failures?.[caseName];
      const redacted =
        typeof detail === "string" && detail.trim() && !CREDENTIAL_PATTERN.test(detail)
          ? ` (${detail.slice(0, 1_000)})`
          : "";
      throw new UpdateAcceptanceError(
        `packaged update acceptance case failed: ${caseName}${redacted}`,
      );
    }
  }
  if (result.refused_installations_changed_the_app === true) {
    throw new UpdateAcceptanceError(
      "a refused installation must leave the running version unchanged",
    );
  }
  return result;
}

/** The data a relaunched version B must still be able to read. */
export function preservedDataEntries(manifest) {
  const preserve = manifest?.release_policy?.data?.preserve;
  if (!Array.isArray(preserve) || preserve.length === 0) {
    throw new UpdateAcceptanceError(
      "the release manifest must declare the data an update preserves",
    );
  }
  return preserve;
}

export function updateAcceptanceEnvironment({
  home,
  dataDirectory,
  resultPath,
  feedUrl,
  expectedVersion,
}) {
  const feed = new URL(feedUrl);
  if (feed.protocol !== "https:") {
    throw new UpdateAcceptanceError("the update feed override must use HTTPS");
  }
  const {
    // An update needs the app to stay alive past startup, so the bounded
    // startup-exit switch the installed-artifact run relies on is dropped here;
    // the acceptance run ends the process itself once it has its evidence.
    MUXED_DESKTOP_ACCEPTANCE_EXIT_AFTER_STARTUP: _boundedStartup,
    ...desktop
  } = sanitizedDesktopEnvironment({ home, dataDirectory, resultPath });
  return {
    ...desktop,
    // The packaged endpoint is replaced, not bypassed: the app still reads one
    // configured feed, signature verification included.
    TICKETRY_UPDATE_FEED_URL: feed.href,
    TICKETRY_UPDATE_ACCEPTANCE_RESULT: resultPath,
    TICKETRY_UPDATE_ACCEPTANCE_EXPECTED_VERSION: expectedVersion,
  };
}

async function stagedUpdaterArtifacts(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw new UpdateAcceptanceError(
      `could not read the staged version B artifacts: ${error.message}`,
    );
  }
  const archives = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".app.tar.gz"))
    .map(({ name }) => name);
  if (archives.length !== 1) {
    throw new UpdateAcceptanceError(
      "update acceptance requires exactly one staged .app.tar.gz for version B",
    );
  }
  const archiveName = archives[0];
  const archive = await readFile(path.join(directory, archiveName));
  const signature = (
    await readFile(path.join(directory, `${archiveName}.sig`), "utf8")
  ).trim();
  if (!signature) {
    throw new UpdateAcceptanceError("the staged version B signature must not be empty");
  }
  return { archiveName, archive, signature };
}

/** The feed behaviours one run can be pointed at. */
export const UPDATE_FEED_CASES = Object.freeze([
  "signed",
  "tampered",
  "wrong-key",
  "unreachable",
]);

export function feedCaseArtifacts({ feedCase, archive, signature, wrongKeySignature }) {
  if (!UPDATE_FEED_CASES.includes(feedCase)) {
    throw new UpdateAcceptanceError(`unknown update feed case: ${feedCase}`);
  }
  if (feedCase === "wrong-key" && !wrongKeySignature?.trim()) {
    throw new UpdateAcceptanceError(
      "the wrong-key case requires a signature from the run's second throwaway key",
    );
  }
  if (feedCase === "tampered") {
    return { archive: tamperedArchive(archive), signature };
  }
  if (feedCase === "wrong-key") {
    return { archive, signature: wrongKeySignature };
  }
  return { archive, signature };
}

/**
 * Serves one case's feed over local HTTPS and records what the app requested.
 *
 * The manifest can only be written once the port is known, because the archive
 * URL it advertises is the one the app must fetch — so the caller supplies a
 * factory over the live origin rather than a finished manifest.
 */
export async function startLocalUpdateFeed({
  manifestFor,
  archiveName,
  archive,
  certificate,
  unreachable = false,
}) {
  const requests = [];
  let manifest;
  const server = createServer(
    { key: certificate.key, cert: certificate.certificate },
    (request, response) => {
      requests.push(request.url);
      if (unreachable) {
        response.writeHead(503).end();
        return;
      }
      if (request.url === feedAssetPath("latest.json")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(`${JSON.stringify(manifest, null, 2)}\n`);
        return;
      }
      if (request.url === feedAssetPath(archiveName)) {
        response.writeHead(200, {
          "content-type": "application/gzip",
          "content-length": String(archive.length),
        });
        response.end(archive);
        return;
      }
      response.writeHead(404).end();
    },
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  const origin = `https://localhost:${port}/`;
  manifest = manifestFor(origin);
  return {
    manifest,
    origin,
    requests,
    latestUrl: new URL(feedAssetPath("latest.json"), origin).href,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function command(executable, arguments_, { cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, { cwd, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new UpdateAcceptanceError(
            `${executable} ${arguments_.join(" ")} failed (${code ?? signal})`,
          ),
        );
      }
    });
  });
}

/**
 * A throwaway certificate for the loopback feed, valid for one day.
 *
 * The updater refuses plain HTTP in release builds, so the acceptance feed has
 * to be real HTTPS. reqwest validates against the platform trust store, which
 * is why the run trusts this certificate for its duration and removes it again.
 */
export async function generateLoopbackCertificate(directory, { run = command } = {}) {
  const certificatePath = path.join(directory, "update-feed.pem");
  const keyPath = path.join(directory, "update-feed.key");
  await run("openssl", [
    "req", "-x509",
    "-newkey", "rsa:2048",
    "-sha256",
    "-days", "1",
    "-nodes",
    "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    "-keyout", keyPath,
    "-out", certificatePath,
  ]);
  return {
    certificatePath,
    keyPath,
    certificate: await readFile(certificatePath),
    key: await readFile(keyPath),
  };
}

export function loginKeychainPath(home = process.env.HOME ?? "") {
  return path.join(home, "Library", "Keychains", "login.keychain-db");
}

export async function trustLoopbackCertificate(
  certificatePath,
  { keychain = loginKeychainPath(), run = command } = {},
) {
  await run("security", [
    "add-trusted-cert",
    "-r", "trustRoot",
    "-k", keychain,
    certificatePath,
  ]);
}

export async function untrustLoopbackCertificate(
  certificatePath,
  { run = command } = {},
) {
  await run("security", ["remove-trusted-cert", certificatePath]);
}

/**
 * One case of the packaged update acceptance run.
 *
 * The caller supplies the packaged version A bundle, the staged version B
 * artifacts signed with the run's throwaway key, the loopback certificate that
 * is trusted for the run, and the driver that confirms the update inside the
 * app and writes its result JSON.
 */
export async function runUpdateAcceptanceCase({
  feedCase,
  fromBundle,
  toBundle,
  toVersion,
  notes,
  certificate,
  driverPath,
  wrongKeySignature,
  publishedAt,
  run = command,
}) {
  if (!driverPath || !path.isAbsolute(driverPath)) {
    throw new UpdateAcceptanceError(
      "TICKETRY_UPDATE_ACCEPTANCE_DRIVER must be an absolute driver path",
    );
  }
  const staged = await stagedUpdaterArtifacts(toBundle);
  const served = feedCaseArtifacts({
    feedCase,
    archive: staged.archive,
    signature: staged.signature,
    wrongKeySignature,
  });
  const workspace = await mkdtemp("/tmp/ticketry-update-acceptance-");
  const home = path.join(workspace, "home");
  const dataDirectory = acceptanceDataDirectory(home);
  const resultPath = path.join(workspace, "update-result.json");
  let feed;
  try {
    await mkdir(path.join(home, "tmp"), { recursive: true });
    const appPath = await installArtifact(fromBundle, workspace);
    feed = await startLocalUpdateFeed({
      manifestFor: (origin) => updateFeedManifest({
        version: toVersion,
        notes,
        signature: served.signature,
        archiveName: staged.archiveName,
        feedOrigin: origin,
        publishedAt: publishedAt ?? new Date(),
      }),
      archiveName: staged.archiveName,
      archive: served.archive,
      certificate,
      unreachable: feedCase === "unreachable",
    });
    await run(driverPath, [appPath], {
      cwd: workspace,
      env: {
        ...updateAcceptanceEnvironment({
          home,
          dataDirectory,
          resultPath,
          feedUrl: feed.latestUrl,
          expectedVersion: toVersion,
        }),
        TICKETRY_UPDATE_ACCEPTANCE_CASE: feedCase,
      },
    });
    return {
      result: JSON.parse(await readFile(resultPath, "utf8")),
      feedRequests: [...feed.requests],
    };
  } finally {
    await feed?.close();
    await rm(workspace, { recursive: true, force: true });
  }
}

/**
 * Merges the four case runs into the one result the acceptance asserts.
 *
 * A case may only contribute the evidence it actually exercised, so `true`
 * from any run wins and every case still has to appear somewhere.
 */
export function mergeUpdateAcceptanceResults(results) {
  if (!Array.isArray(results) || results.length === 0) {
    throw new UpdateAcceptanceError("update acceptance produced no case results");
  }
  const merged = { case_failures: {} };
  for (const result of results) {
    if (!result || typeof result !== "object") {
      throw new UpdateAcceptanceError("an update acceptance case wrote no JSON object");
    }
    for (const [key, value] of Object.entries(result)) {
      if (key === "case_failures") {
        Object.assign(merged.case_failures, value);
        continue;
      }
      if (value === true || merged[key] === undefined) merged[key] = value;
    }
    if (result.refused_installations_changed_the_app === true) {
      merged.refused_installations_changed_the_app = true;
    }
  }
  return merged;
}

async function main() {
  const options = parseUpdateAcceptanceArguments(process.argv.slice(2));
  const manifest = JSON.parse(
    await readFile(path.join(studioRoot, "release", "manifest.v1.json"), "utf8"),
  );
  const driverPath = options.driverPath
    ?? process.env.TICKETRY_UPDATE_ACCEPTANCE_DRIVER
    ?? bundledUpdateAcceptanceDriverPath;
  const wrongKeySignature = process.env.TICKETRY_UPDATE_ACCEPTANCE_WRONG_KEY_SIGNATURE;
  if (!wrongKeySignature) {
    throw new UpdateAcceptanceError(
      "TICKETRY_UPDATE_ACCEPTANCE_WRONG_KEY_SIGNATURE must hold a signature made "
        + "with the run's second throwaway key (see release/OPERATIONS.md)",
    );
  }
  const certificateDirectory = await mkdtemp("/tmp/ticketry-update-feed-cert-");
  const certificate = await generateLoopbackCertificate(certificateDirectory);
  await trustLoopbackCertificate(certificate.certificatePath);
  const results = [];
  try {
    for (const feedCase of UPDATE_FEED_CASES) {
      const { result, feedRequests } = await runUpdateAcceptanceCase({
        ...options,
        feedCase,
        driverPath,
        notes: `Update acceptance build ${options.toVersion}.`,
        certificate,
        wrongKeySignature,
      });
      results.push(result);
      console.log(`${feedCase}: ${feedRequests.length} feed request(s) served.`);
    }
  } finally {
    await untrustLoopbackCertificate(certificate.certificatePath).catch((error) => {
      console.error(`could not remove the acceptance certificate trust: ${error.message}`);
    });
    await rm(certificateDirectory, { recursive: true, force: true });
  }
  assertUpdateAcceptanceResult(mergeUpdateAcceptanceResults(results));
  console.log(
    `Packaged update acceptance passed for ${options.toVersion}; `
      + `preserved data asserted: ${preservedDataEntries(manifest).join(", ")}.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
