#!/usr/bin/env node
// Read the persisted global launch default straight out of Ticketry's SQLite
// state database, bypassing the GraphQL adapter and every client cache.
//
// The Models settings section writes `app_settings(host, provider_catalog)`;
// this script is the independent oracle that a save reached storage rather
// than only the Apollo cache or an in-flight response.
//
// Usage:
//   node scripts/read-persisted-model-settings.mjs --temp-profile
//   node scripts/read-persisted-model-settings.mjs --data-dir ~/.ticketry
//   node scripts/read-persisted-model-settings.mjs --temp-profile \
//     --expect-provider claude --expect-model opus --expect-reasoning high
//
// It prints one JSON document on stdout. With any --expect-* flag it also
// exits nonzero when the stored default disagrees.

import { existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const TEMPORARY_PROFILE_PREFIX = "ticketry-temp-sqlite-";
const STATE_DATABASE = "state.db";
const PROVIDER_CATALOG_SCOPE = "host";
const PROVIDER_CATALOG_KEY = "provider_catalog";

export function parseOptions(argv) {
  const options = {
    dataDirectory: null,
    temporaryProfile: false,
    expected: {},
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined) throw new Error(`${argument} needs a value`);
      index += 1;
      return next;
    };
    switch (argument) {
      case "--data-dir":
        options.dataDirectory = value();
        break;
      case "--temp-profile":
        options.temporaryProfile = true;
        break;
      case "--expect-provider":
        options.expected.provider = value();
        break;
      case "--expect-model":
        options.expected.model = value();
        break;
      case "--expect-reasoning":
        options.expected.reasoning = value();
        break;
      default:
        throw new Error(`unknown option: ${argument}`);
    }
  }
  if (options.dataDirectory && options.temporaryProfile) {
    throw new Error("choose either --data-dir or --temp-profile, not both");
  }
  return options;
}

/** The newest temporary SQLite profile, which is the one an e2e run created. */
export function findTemporaryProfile({ temporaryRoot = tmpdir() } = {}) {
  const profiles = readdirSync(temporaryRoot)
    .filter((entry) => entry.startsWith(TEMPORARY_PROFILE_PREFIX))
    .map((entry) => path.join(temporaryRoot, entry))
    .filter((directory) => existsSync(path.join(directory, STATE_DATABASE)))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  if (profiles.length === 0) {
    throw new Error(
      `no temporary Ticketry profile with a ${STATE_DATABASE} under ${temporaryRoot}`,
    );
  }
  return profiles[0];
}

export function resolveDataDirectory(options) {
  if (options.dataDirectory) return path.resolve(options.dataDirectory);
  if (options.temporaryProfile) return findTemporaryProfile();
  if (process.env.MUXED_DATA_DIR) return path.resolve(process.env.MUXED_DATA_DIR);
  return findTemporaryProfile();
}

/** Mirror of the Rust reader: an unrecognized document carries no default. */
export function parseGlobalLaunchDefault(value) {
  let document;
  try {
    document = JSON.parse(value);
  } catch {
    return null;
  }
  const raw = document?.global_default;
  if (!raw || typeof raw !== "object") return null;
  const known = ["provider", "model", "reasoning"];
  if (Object.keys(raw).some((key) => !known.includes(key))) return null;
  const provider = typeof raw.provider === "string" ? raw.provider.trim() : "";
  if (!provider) return null;
  const optional = (field) =>
    raw[field] === undefined || raw[field] === null
      ? null
      : typeof raw[field] === "string"
        ? raw[field]
        : undefined;
  const model = optional("model");
  const reasoning = optional("reasoning");
  if (model === undefined || reasoning === undefined) return null;
  return { provider, model, reasoning };
}

export function readProviderCatalogSetting(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = database
      .prepare(
        "SELECT value, updated_at FROM app_settings WHERE scope = ? AND key = ?",
      )
      .get(PROVIDER_CATALOG_SCOPE, PROVIDER_CATALOG_KEY);
    if (!row) return { value: null, updatedAt: null, globalDefault: null };
    return {
      value: row.value,
      updatedAt: row.updated_at,
      globalDefault: parseGlobalLaunchDefault(row.value),
    };
  } finally {
    database.close();
  }
}

export function describeMismatches(expected, globalDefault) {
  return Object.entries(expected)
    .filter(([field, value]) => (globalDefault?.[field] ?? null) !== value)
    .map(([field, value]) =>
      `${field}: expected ${JSON.stringify(value)}, stored ${
        JSON.stringify(globalDefault?.[field] ?? null)
      }`);
}

function main() {
  const options = parseOptions(process.argv.slice(2));
  const dataDirectory = resolveDataDirectory(options);
  const databasePath = path.join(dataDirectory, STATE_DATABASE);
  if (!existsSync(databasePath)) {
    throw new Error(`no Ticketry state database at ${databasePath}`);
  }
  const setting = readProviderCatalogSetting(databasePath);
  const mismatches = describeMismatches(options.expected, setting.globalDefault);
  process.stdout.write(`${JSON.stringify({
    data_directory: dataDirectory,
    database_path: databasePath,
    updated_at: setting.updatedAt,
    stored_value: setting.value,
    global_default: setting.globalDefault,
    mismatches,
  }, null, 2)}\n`);
  if (mismatches.length > 0) {
    console.error(`Persisted model settings do not match:\n  ${mismatches.join("\n  ")}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  main();
}
