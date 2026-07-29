import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest } from "./release-build.mjs";

const studioRoot = fileURLToPath(new URL("..", import.meta.url));
const githubApi = "https://api.github.com";
const githubUploads = "https://uploads.github.com";

export class GitHubReleasePublisherError extends Error {}

export function parsePublisherArguments(arguments_) {
  let targetId;
  let tag;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--target") {
      targetId = arguments_[index + 1];
      index += 1;
    } else if (argument === "--tag") {
      tag = arguments_[index + 1];
      index += 1;
    } else {
      throw new GitHubReleasePublisherError(`unknown GitHub publisher option: ${argument}`);
    }
  }
  if (!targetId) {
    throw new GitHubReleasePublisherError("--target requires a manifest target id");
  }
  if (!tag) {
    throw new GitHubReleasePublisherError("--tag requires an existing version tag");
  }
  return { targetId, tag };
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

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function loadStagedAssets(manifest, target, { root = studioRoot } = {}) {
  const directory = path.join(
    root,
    "release-output",
    manifest.release_version,
    target.id,
  );
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw new GitHubReleasePublisherError(
      `could not read staged artifacts for ${target.id}: ${error.message}`,
    );
  }
  const dmgEntries = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".dmg"));
  if (dmgEntries.length !== 1) {
    throw new GitHubReleasePublisherError(
      `expected exactly one staged .dmg for ${target.id}, found ${dmgEntries.length}`,
    );
  }

  const metadataName = "release-metadata.json";
  let dmgContent;
  let metadataContent;
  try {
    [dmgContent, metadataContent] = await Promise.all([
      readFile(path.join(directory, dmgEntries[0].name)),
      readFile(path.join(directory, metadataName)),
    ]);
  } catch (error) {
    throw new GitHubReleasePublisherError(
      `could not read staged release files for ${target.id}: ${error.message}`,
    );
  }

  let metadata;
  try {
    metadata = JSON.parse(metadataContent.toString("utf8"));
  } catch (error) {
    throw new GitHubReleasePublisherError(`release-metadata.json is invalid JSON: ${error.message}`);
  }
  if (metadata.release_version !== manifest.release_version || metadata.target !== target.id) {
    throw new GitHubReleasePublisherError(
      "release-metadata.json does not match the selected release version and target",
    );
  }
  if (metadata.signed !== false || metadata.notarized !== false) {
    throw new GitHubReleasePublisherError(
      "private unsigned publisher requires signed=false and notarized=false metadata",
    );
  }

  return [
    {
      name: dmgEntries[0].name,
      content: dmgContent,
      contentType: "application/x-apple-diskimage",
      digest: sha256(dmgContent),
    },
    {
      name: metadataName,
      content: metadataContent,
      contentType: "application/json",
      digest: sha256(metadataContent),
    },
  ];
}

export function buildReleaseNotes(manifest, target, assets) {
  const minimumMacOS = target.compatibility.minimum_os;
  if (!minimumMacOS || target.compatibility.tmux !== "external-prerequisite") {
    throw new GitHubReleasePublisherError(
      `manifest compatibility data for ${target.id} must declare minimum macOS and external tmux`,
    );
  }
  const digests = assets
    .map(({ name, digest }) => `- \`${digest}  ${name}\``)
    .join("\n");
  return `# Ticketry ${manifest.release_version}

This build is **unsigned and not notarized**.

- Minimum macOS version: **${minimumMacOS}**
- External prerequisite: **tmux** must already be installed and available on \`PATH\`.

## Install and clear quarantine

1. Open the downloaded DMG and drag \`Ticketry.app\` into \`/Applications\`.
2. Try to open Ticketry once, then close the macOS warning.
3. Open **System Settings → Privacy & Security**, find the Ticketry security message, click **Open Anyway**, then confirm **Open**.
4. If the security message is unavailable, open Terminal and run this exact quarantine-clearing command:

\`\`\`sh
sudo /usr/bin/xattr -dr com.apple.quarantine "/Applications/Ticketry.app"
\`\`\`

5. Enter your macOS account password when prompted, then open Ticketry from \`/Applications\`.

The quarantine command is required because this private build is unsigned and not notarized.

## SHA-256 content digests

${digests}
`;
}

function githubHeaders(token, extra = {}) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "ticketry-private-release-publisher",
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
      // GitHub error bodies are optional and never needed to make a safe decision.
    }
    throw new GitHubReleasePublisherError(
      `GitHub request failed with HTTP ${response.status}${detail}`,
    );
  }
  if (response.status === 204) return undefined;
  return response.json();
}

function validateRepository(repository) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
    throw new GitHubReleasePublisherError(
      "GITHUB_REPOSITORY must name the private destination as owner/repository",
    );
  }
}

export async function publishGitHubRelease({
  manifest,
  targetId,
  tag,
  repository,
  token,
  fetchImpl = globalThis.fetch,
  verifyLocalTag = localTagExists,
  readAssets = loadStagedAssets,
}) {
  const target = manifest.targets.find(({ id }) => id === targetId);
  if (!target) {
    throw new GitHubReleasePublisherError(`target "${targetId}" is not declared in the manifest`);
  }
  if (tag !== manifest.release_version) {
    throw new GitHubReleasePublisherError(
      `tag "${tag}" does not match release_version "${manifest.release_version}"`,
    );
  }
  if (!(await verifyLocalTag(tag))) {
    throw new GitHubReleasePublisherError(`local version tag "${tag}" does not exist`);
  }
  validateRepository(repository);
  if (!token) {
    throw new GitHubReleasePublisherError("GITHUB_TOKEN must contain a scoped GitHub token");
  }
  if (typeof fetchImpl !== "function") {
    throw new GitHubReleasePublisherError("this Node.js runtime does not provide fetch");
  }

  const assets = await readAssets(manifest, target);
  const notes = buildReleaseNotes(manifest, target, assets);
  const repositoryPath = repository.split("/").map(encodeURIComponent).join("/");
  const tagPath = encodeURIComponent(tag);
  const repositoryUrl = `${githubApi}/repos/${repositoryPath}`;

  const repositoryDetails = await githubRequest(fetchImpl, token, repositoryUrl);
  if (repositoryDetails.private !== true) {
    throw new GitHubReleasePublisherError(
      `refusing to publish unsigned artifacts because ${repository} is not private`,
    );
  }

  const remoteTag = await fetchImpl(`${repositoryUrl}/git/ref/tags/${tagPath}`, {
    headers: githubHeaders(token),
  });
  if (remoteTag.status === 404) {
    throw new GitHubReleasePublisherError(`remote version tag "${tag}" does not exist`);
  }
  if (remoteTag.status !== 200) {
    throw new GitHubReleasePublisherError(
      `could not verify remote version tag "${tag}" (HTTP ${remoteTag.status})`,
    );
  }

  const existingRelease = await fetchImpl(`${repositoryUrl}/releases/tags/${tagPath}`, {
    headers: githubHeaders(token),
  });
  if (existingRelease.status === 200) {
    throw new GitHubReleasePublisherError(
      `release for tag "${tag}" already exists; refusing to overwrite it`,
    );
  }
  if (existingRelease.status !== 404) {
    throw new GitHubReleasePublisherError(
      `could not verify that release tag "${tag}" is unused (HTTP ${existingRelease.status})`,
    );
  }

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
        body: notes,
        draft: true,
        prerelease: false,
      }),
    },
    [201],
  );
  if (!Number.isInteger(release.id)) {
    throw new GitHubReleasePublisherError("GitHub did not return a release id");
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
      body: JSON.stringify({ draft: false }),
    },
  );
  return { repository, tag, assets: assets.map(({ name, digest }) => ({ name, digest })) };
}

async function main() {
  const { targetId, tag } = parsePublisherArguments(process.argv.slice(2));
  const manifest = await loadManifest();
  const result = await publishGitHubRelease({
    manifest,
    targetId,
    tag,
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
  });
  console.log(
    `Published private GitHub release ${result.repository}@${result.tag} with ${result.assets.length} assets.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
