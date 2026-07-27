import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("OpenAPI export runs from the current ticketry backend", (context) => {
  if (process.platform === "win32") {
    context.skip("the fake Python executable is POSIX-only");
    return;
  }

  const fixture = mkdtempSync(join(tmpdir(), "worktracker-openapi-export-"));
  const fakePython = join(fixture, "python");
  const log = join(fixture, "invocation.log");
  writeFileSync(
    fakePython,
    [
      "#!/bin/sh",
      "pwd > \"$CONTRACT_EXPORT_LOG\"",
      "printf '%s\\n' \"$@\" >> \"$CONTRACT_EXPORT_LOG\"",
      "printf 'DJANGO_SETTINGS_MODULE=%s\\n' \"$DJANGO_SETTINGS_MODULE\" >> \"$CONTRACT_EXPORT_LOG\"",
      "",
    ].join("\n"),
  );
  chmodSync(fakePython, 0o755);

  const stack = resolve(import.meta.dirname, "..");
  const result = spawnSync(
    process.execPath,
    [resolve(import.meta.dirname, "export-openapi.mjs")],
    {
      cwd: stack,
      encoding: "utf8",
      env: {
        ...process.env,
        CONTRACT_EXPORT_LOG: log,
        WORKTRACKER_PYTHON: fakePython,
      },
    },
  );

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), [
      resolve(stack, "backend"),
      "-m",
      "django",
      "export_openapi",
      resolve(stack, "openapi.json"),
      "DJANGO_SETTINGS_MODULE=worktracker.openapi_settings",
    ]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("OpenAPI export can target a temporary contract-check artifact", (context) => {
  if (process.platform === "win32") {
    context.skip("the fake Python executable is POSIX-only");
    return;
  }

  const fixture = mkdtempSync(join(tmpdir(), "worktracker-openapi-export-"));
  const fakePython = join(fixture, "python");
  const log = join(fixture, "invocation.log");
  const destination = join(fixture, "fresh-openapi.json");
  writeFileSync(
    fakePython,
    [
      "#!/bin/sh",
      "printf '%s\\n' \"$@\" > \"$CONTRACT_EXPORT_LOG\"",
      "",
    ].join("\n"),
  );
  chmodSync(fakePython, 0o755);

  const stack = resolve(import.meta.dirname, "..");
  const result = spawnSync(
    process.execPath,
    [resolve(import.meta.dirname, "export-openapi.mjs")],
    {
      cwd: stack,
      encoding: "utf8",
      env: {
        ...process.env,
        CONTRACT_EXPORT_LOG: log,
        WORKTRACKER_OPENAPI_DESTINATION: destination,
        WORKTRACKER_PYTHON: fakePython,
      },
    },
  );

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), [
      "-m",
      "django",
      "export_openapi",
      destination,
    ]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
