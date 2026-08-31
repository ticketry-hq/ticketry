import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest } from "./release-build.mjs";

const studioRoot = fileURLToPath(new URL("..", import.meta.url));
const githubApi = "https://api.github.com";
const githubUploads = "https://uploads.github.com";

export class PublicUpdatePublisherError extends Error {}

export function parsePublicUpdatePublisherArguments(arguments_) {
  const values = {};
  const options = new Map([
    ["--target", "targetId"],
    ["--tag", "tag"],
    ["--repository", "repository"],
    ["--notes-file", "notesFile"],
  ]);
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index];
    const key = options.get(option);
    if (!key) {
      throw new PublicUpdatePublisherError(`unknown public update publisher option: ${option}`);
    }
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) {
      throw new PublicUpdatePublisherError(`${option} requires a value`);
    }
    values[key] = value;
  }
  for (const [key, message] of [
    ["targetId", "--target requires a manifest target id"],
    ["tag", "--tag requires an existing version tag"],
    ["repository", "--repository requires an owner/repository destination"],
    ["notesFile", "--notes-file requires a release-notes path"],
  ]) {
    if (!values[key]) throw new PublicUpdatePublisherError(message);
  }
  return values;
}

function localTagExists(tag, { cwd = studioRoot } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      ["show-ref", "--verify", "--quiet", `refs/tags/${tag}`],
      { cwd, stdio: "ignore" },
    );
    child.once("error", reject);
    child.once("exit", (code) => resolve(code === 0));
  });
}

async function loadStagedAssets(manifest, targetId, root) {
  const directory = path.join(
    root,
    "release-output",
    manifest.release_version,
    targetId,
  );
  let metadata;
  try {
    metadata = JSON.parse(await readFile(path.join(directory, "release-metadata.json"), "utf8"));
  } catch (error) {
    throw new PublicUpdatePublisherError(
      `could not read valid staged release-metadata.json: ${error.message}`,
    );
  }
  if (metadata.release_version !== manifest.release_version || metadata.target !== targetId) {
    throw new PublicUpdatePublisherError(
      "release-metadata.json does not match the selected release version and target",
    );
  }
  if (metadata.signed !== true || metadata.notarized !== true) {
    throw new PublicUpdatePublisherError(
      "public update publication requires signed=true and notarized=true metadata",
    );
  }

  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw new PublicUpdatePublisherError(
      `could not read staged updater artifacts: ${error.message}`,
    );
  }
  const archiveNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".app.tar.gz"))
    .map(({ name }) => name);
  const signatureNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sig"))
    .map(({ name }) => name);
  if (
    archiveNames.length !== 1
    || signatureNames.length !== 1
    || signatureNames[0] !== `${archiveNames[0]}.sig`
  ) {
    throw new PublicUpdatePublisherError(
      "public update publication requires exactly one staged .app.tar.gz and its matching .sig",
    );
  }

  let archiveContent;
  let signatureContent;
  try {
    [archiveContent, signatureContent] = await Promise.all([
      readFile(path.join(directory, archiveNames[0])),
      readFile(path.join(directory, signatureNames[0])),
    ]);
  } catch (error) {
    throw new PublicUpdatePublisherError(
      `could not read staged updater artifacts: ${error.message}`,
    );
  }
  const signature = signatureContent.toString("utf8").trim();
  if (!signature) {
    throw new PublicUpdatePublisherError("the staged updater signature must not be empty");
  }

  return {
    archiveName: archiveNames[0],
    archiveContent,
    signatureName: signatureNames[0],
    signatureContent,
    signature,
  };
}

function githubHeaders(token, extra = {}) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "ticketry-public-update-publisher",
    "X-GitHub-Api-Version": "2022-11-28",
    ...extra,
  };
}

async function githubRequest(fetchImpl, token, url, options = {}, allowedStatuses = [200]) {
  const response = await fetchImpl(url, {
    ...options,
    headers: githubHeaders(token, options.headers),
  });
  if (!allowedStatuses.includes(response.status)) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = typeof payload.message === "string" ? `: ${payload.message}` : "";
    } catch {
      // Error response bodies are optional and do not change the safe outcome.
    }
    throw new PublicUpdatePublisherError(
      `GitHub request failed with HTTP ${response.status}${detail}`,
    );
  }
  if (response.status === 204) return undefined;
  return response.json();
}

function assertRepositoryName(repository, label) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
    throw new PublicUpdatePublisherError(`${label} must use owner/repository syntax`);
  }
}

export async function publishPublicUpdateRelease({
  manifest,
  targetId,
  tag,
  repository,
  configuredRepository,
  token,
  notes,
  publishedAt = new Date(),
  fetchImpl = globalThis.fetch,
  root = studioRoot,
  verifyLocalTag = localTagExists,
}) {
  assertRepositoryName(configuredRepository, "configured public releases repository");
  assertRepositoryName(repository, "public releases repository");
  if (!configuredRepository || repository !== configuredRepository) {
    throw new PublicUpdatePublisherError(
      `refusing to publish updates to ${repository ?? "an unspecified repository"}; `
      + `the configured public releases repository is ${configuredRepository ?? "missing"}`,
    );
  }

  const target = manifest.targets.find(({ id }) => id === targetId);
  if (!target) {
    throw new PublicUpdatePublisherError(`target "${targetId}" is not declared in the manifest`);
  }
  if (tag !== manifest.release_version) {
    throw new PublicUpdatePublisherError(
      `tag "${tag}" does not match release_version "${manifest.release_version}"`,
    );
  }
  if (!(await verifyLocalTag(tag))) {
    throw new PublicUpdatePublisherError(`local version tag "${tag}" does not exist`);
  }
  if (!token) {
    throw new PublicUpdatePublisherError("GITHUB_TOKEN must contain a scoped GitHub token");
  }
  if (typeof fetchImpl !== "function") {
    throw new PublicUpdatePublisherError("this Node.js runtime does not provide fetch");
  }
  const normalizedNotes = typeof notes === "string" ? notes.trim() : "";
  if (!normalizedNotes) {
    throw new PublicUpdatePublisherError("release notes must not be empty");
  }
  const publicationDate = publishedAt instanceof Date ? publishedAt : new Date(publishedAt);
  if (Number.isNaN(publicationDate.valueOf())) {
    throw new PublicUpdatePublisherError("publication date must be a valid date");
  }

  const staged = await loadStagedAssets(manifest, target.id, root);

  const repositoryPath = repository.split("/").map(encodeURIComponent).join("/");
  const repositoryUrl = `${githubApi}/repos/${repositoryPath}`;
  const repositoryDetails = await githubRequest(fetchImpl, token, repositoryUrl);
  if (repositoryDetails.visibility !== "public" || repositoryDetails.private !== false) {
    throw new PublicUpdatePublisherError(
      `refusing to publish updates because ${repository} visibility is not public`,
    );
  }

  const tagPath = encodeURIComponent(tag);
  const existingRelease = await fetchImpl(`${repositoryUrl}/releases/tags/${tagPath}`, {
    headers: githubHeaders(token),
  });
  if (existingRelease.status === 200) {
    throw new PublicUpdatePublisherError(
      `release for tag "${tag}" already exists; refusing to overwrite it`,
    );
  }
  if (existingRelease.status !== 404) {
    throw new PublicUpdatePublisherError(
      `could not verify that release tag "${tag}" is unused (HTTP ${existingRelease.status})`,
    );
  }

  const archiveUrl = `https://github.com/${repository}/releases/download/${tagPath}/${encodeURIComponent(staged.archiveName)}`;
  const latest = {
    version: manifest.release_version,
    notes: normalizedNotes,
    pub_date: publicationDate.toISOString(),
    platforms: {
      "darwin-aarch64": {
        signature: staged.signature,
        url: archiveUrl,
      },
    },
  };
  const assets = [
    {
      name: staged.archiveName,
      content: staged.archiveContent,
      contentType: "application/gzip",
    },
    {
      name: staged.signatureName,
      content: staged.signatureContent,
      contentType: "text/plain; charset=utf-8",
    },
    {
      name: "latest.json",
      content: Buffer.from(`${JSON.stringify(latest, null, 2)}\n`),
      contentType: "application/json",
    },
  ];

  const release = await githubRequest(
    fetchImpl,
    token,
    `${repositoryUrl}/releases`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tag_name: tag,
        name: `Ticketry ${tag}`,
        body: normalizedNotes,
        draft: true,
        prerelease: false,
      }),
    },
    [201],
  );
  if (!Number.isInteger(release.id)) {
    throw new PublicUpdatePublisherError("GitHub did not return a release id");
  }

  for (const asset of assets) {
    await githubRequest(
      fetchImpl,
      token,
      `${githubUploads}/repos/${repositoryPath}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": asset.contentType,
          "Content-Length": String(asset.content.byteLength),
        },
        body: asset.content,
      },
      [201],
    );
  }

  await githubRequest(
    fetchImpl,
    token,
    `${repositoryUrl}/releases/${release.id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: false, prerelease: false }),
    },
  );

  return { repository, tag, assets: assets.map(({ name }) => name) };
}

async function main() {
  const { targetId, tag, repository, notesFile } = parsePublicUpdatePublisherArguments(
    process.argv.slice(2),
  );
  const [manifest, notes] = await Promise.all([
    loadManifest(),
    readFile(path.resolve(process.cwd(), notesFile), "utf8"),
  ]);
  const result = await publishPublicUpdateRelease({
    manifest,
    targetId,
    tag,
    repository,
    configuredRepository: process.env.TICKETRY_PUBLIC_RELEASES_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
    notes,
  });
  console.log(
    `Published public update release ${result.repository}@${result.tag} with ${result.assets.length} assets.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
