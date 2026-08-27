import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";

import { createTemporarySqliteProfile } from "../studio/scripts/desktop-dev.mjs";
import {
  resolveProductDataDirectory,
} from "./product-identity.mjs";

const sqliteDatabases = ["state.db", "rust-core.sqlite3"];
const companionEntries = ["media", "profiles.json", "approved-executables.json"];
export {
  resolveProductDataDirectory,
  resolveProductDataDirectory as resolveEstablishedProductDataDirectory,
};

function sqliteString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function snapshotSqliteDatabase(source, destination, runner) {
  runner("sqlite3", [source, `.backup ${sqliteString(destination)}`], {
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function copyCompanionEntry(sourceDirectory, destinationDirectory, name) {
  const source = path.join(sourceDirectory, name);
  if (!existsSync(source)) return;
  cpSync(source, path.join(destinationDirectory, name), {
    recursive: lstatSync(source).isDirectory(),
  });
}

export function createProductDataSnapshot({
  sourceDirectory,
  temporaryRoot,
  runner = execFileSync,
} = {}) {
  if (!sourceDirectory) {
    throw new Error("the Ticketry product data directory is required");
  }
  const sourceDatabase = path.join(sourceDirectory, "state.db");
  if (!existsSync(sourceDatabase) || !lstatSync(sourceDatabase).isFile()) {
    throw new Error(`Ticketry product database was not found at ${sourceDatabase}`);
  }

  const destinationDirectory = createTemporarySqliteProfile({ temporaryRoot });
  try {
    mkdirSync(destinationDirectory, { recursive: true });
    for (const name of sqliteDatabases) {
      const source = path.join(sourceDirectory, name);
      if (!existsSync(source)) continue;
      snapshotSqliteDatabase(source, path.join(destinationDirectory, name), runner);
    }
    for (const name of companionEntries) {
      copyCompanionEntry(sourceDirectory, destinationDirectory, name);
    }
    return destinationDirectory;
  } catch (error) {
    rmSync(destinationDirectory, { recursive: true, force: true });
    throw new Error(`could not snapshot the Ticketry product database: ${error.message}`);
  }
}
