import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  productIdentity,
  resolveProductDataDirectory,
} from "./product-identity.mjs";

test("the product identity maps installed and web runtimes to its default profile", () => {
  assert.equal(
    resolveProductDataDirectory({ environment: { HOME: "/users/ticketry" } }),
    path.join(
      "/users/ticketry/.config",
      productIdentity.defaultDataDirectoryName,
    ),
  );
});

test("a configured directory name replaces the manifest default", () => {
  assert.equal(
    resolveProductDataDirectory({
      environment: {
        HOME: "/users/ticketry",
        [productIdentity.dataDirectoryNameEnvironmentVariable]: "ticketry-next",
      },
    }),
    "/users/ticketry/.config/ticketry-next",
  );
});

test("an explicit Ticketry path wins over the configured directory name", () => {
  const variable = productIdentity.dataDirectoryPathEnvironmentVariables[0];
  assert.equal(
    resolveProductDataDirectory({
      cwd: "/repository",
      environment: {
        HOME: "/users/ticketry",
        [variable]: "../shared-ticketry-data",
        [productIdentity.dataDirectoryNameEnvironmentVariable]: "ignored-name",
      },
    }),
    path.resolve("/repository", "../shared-ticketry-data"),
  );
});

test("a configured directory name cannot escape the config directory", () => {
  assert.throws(
    () => resolveProductDataDirectory({
      environment: {
        HOME: "/users/ticketry",
        [productIdentity.dataDirectoryNameEnvironmentVariable]: "../outside",
      },
    }),
    /must be one directory name/,
  );
});
