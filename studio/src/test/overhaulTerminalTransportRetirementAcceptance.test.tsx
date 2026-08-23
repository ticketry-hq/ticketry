import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The terminal cutover, observed from Studio's own source.
 *
 * Terminal launch, persistence, viewer ownership, and output observation are
 * owned by the Rust terminal lifecycle; the bytes arrive over Tauri. The Python
 * side of that — the `/api/terminals` REST family and the `/ws/terminal`
 * socket — was retired, and `backend/studio_server/routing.py` now declares an
 * empty WebSocket route table.
 *
 * A dead URL is worse than a missing feature: it looks like a working fallback
 * and fails as a 404 at the moment a user opens a terminal. So the rule this
 * file holds is structural rather than behavioural — no shipping module may
 * build either transport, whatever it would have done with it.
 *
 * Comments are exempt, and so are specs including this one: a seam that refuses
 * has to say which route it replaced, and proving a pattern is absent requires
 * writing that pattern down.
 */

const SRC_ROOT = join(process.cwd(), "src");
const SPEC_ROOT = join(SRC_ROOT, "test");
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

const RETIRED_TRANSPORTS = [
  // The Python terminal REST family.
  "/api/terminals",
  // The terminal byte socket and the runtime endpoint that addressed it.
  "/ws/terminal",
  "terminalWebSocket",
  "websocketTerminal",
];

function shippingSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return path === SPEC_ROOT ? [] : shippingSources(path);
    }
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) {
      return [];
    }
    return SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))
      ? [path]
      : [];
  });
}

/** True for a line that is prose rather than code. */
function isComment(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*")
  );
}

function offendingLines(source: string, label: string): string[] {
  return source
    .split("\n")
    .flatMap((text, index) =>
      !isComment(text) &&
      RETIRED_TRANSPORTS.some((transport) => text.includes(transport))
        ? [`${label}:${index + 1}: ${text.trim()}`]
        : [],
    );
}

function offendingSourceLines(): string[] {
  return shippingSources(SRC_ROOT).flatMap((path) =>
    offendingLines(readFileSync(path, "utf8"), relative(SRC_ROOT, path)),
  );
}

describe("overhaul acceptance — retired terminal transports", () => {
  it("constructs no terminal REST or WebSocket URL anywhere in shipping Studio source", () => {
    expect(offendingSourceLines()).toEqual([]);
  });

  it("keeps the development proxy free of a WebSocket forward", () => {
    // Nothing listens on `/ws` any more, so a proxy entry could only forward a
    // browser tab into a connection that never completes.
    const proxy = readFileSync(join(process.cwd(), "vite.proxy.ts"), "utf8");

    expect(
      proxy.split("\n").filter((text) => !isComment(text) && text.includes("/ws")),
    ).toEqual([]);
  });
});
