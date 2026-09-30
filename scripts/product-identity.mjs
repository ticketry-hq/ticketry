import { readFileSync } from "node:fs";
import path from "node:path";

const manifestUrl = new URL("../config/product-identity.json", import.meta.url);

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`product identity ${field} must be a non-empty string`);
  }
  return value.trim();
}

function requiredStringArray(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`product identity ${field} must contain at least one name`);
  }
  return value.map((entry) => requiredString(entry, field));
}

function validDirectoryName(value) {
  return value !== "."
    && value !== ".."
    && path.basename(value) === value
    && !value.includes("/")
    && !value.includes("\\");
}

function readProductIdentity() {
  const parsed = JSON.parse(readFileSync(manifestUrl, "utf8"));
  const identity = {
    defaultDataDirectoryName: requiredString(
      parsed.defaultDataDirectoryName,
      "defaultDataDirectoryName",
    ),
    dataDirectoryNameEnvironmentVariable: requiredString(
      parsed.dataDirectoryNameEnvironmentVariable,
      "dataDirectoryNameEnvironmentVariable",
    ),
    dataDirectoryPathEnvironmentVariables: requiredStringArray(
      parsed.dataDirectoryPathEnvironmentVariables,
      "dataDirectoryPathEnvironmentVariables",
    ),
    legacyDataDirectoryNames: Array.isArray(parsed.legacyDataDirectoryNames)
      ? parsed.legacyDataDirectoryNames.map((entry) =>
          requiredString(entry, "legacyDataDirectoryNames"))
      : [],
  };
  if (!validDirectoryName(identity.defaultDataDirectoryName)) {
    throw new Error("product identity defaultDataDirectoryName must be one directory name");
  }
  return Object.freeze(identity);
}

export const productIdentity = readProductIdentity();

export function resolveProductDataDirectory({
  cwd = process.cwd(),
  environment = process.env,
} = {}) {
  for (const variable of productIdentity.dataDirectoryPathEnvironmentVariables) {
    const value = environment[variable];
    if (typeof value === "string" && value.trim() !== "") {
      return path.resolve(cwd, value);
    }
  }
  if (!environment.HOME) {
    throw new Error("could not determine HOME for the product data directory");
  }
  const configuredName = environment[
    productIdentity.dataDirectoryNameEnvironmentVariable
  ];
  const directoryName = typeof configuredName === "string" && configuredName.trim() !== ""
    ? configuredName.trim()
    : productIdentity.defaultDataDirectoryName;
  if (!validDirectoryName(directoryName)) {
    throw new Error(
      `${productIdentity.dataDirectoryNameEnvironmentVariable} must be one directory name`,
    );
  }
  return path.join(environment.HOME, ".config", directoryName);
}
