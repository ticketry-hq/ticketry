import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The terminal cutover, observed from Studio's own source.
 *
 * Terminal launch, persistence, viewer ownership, and output observation are
 * owned by the Rust terminal lifecycle; desktop bytes arrive over Tauri.
 * Browser development attaches to those same durable runs through exactly one
 * intended PTY WebSocket: the attach-only `/ws/terminal` client, forwarded by
 * the development proxy with WebSocket upgrades enabled. There is still no
 * terminal REST API, and nothing can spawn a run or session from a socket —
 * a durable run is created only through GraphQL, then attached. GraphQL
 * subscriptions remain SSE-over-fetch.
 *
 * A dead URL is worse than a missing feature: it looks like a working fallback
 * and fails as a 404 the moment a user opens a terminal. So most of this file
 * holds structural rules rather than behavioural ones — nothing ships a second
 * transport, whatever it would have done with it.
 *
 * Comments are exempt, and so are specs including this one: a seam that
 * refuses has to say which route it replaced, and proving a pattern is absent
 * requires writing that pattern down.
 */

const SRC_ROOT = join(process.cwd(), "src");
const SPEC_ROOT = join(SRC_ROOT, "test");
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

// The Python terminal REST family stays retired everywhere in shipping code.
const RETIRED_REST_ROUTES = ["/api/terminals"];

// The one intended terminal byte socket, addressed identically at every site.
const INTENDED_TERMINAL_SOCKET = "/ws/terminal";

// The only shipping module allowed to construct a terminal WebSocket, plus
// its single outbound frame contract.
const INTENDED_WS_CLIENT =
  "features/agents/terminal/internal/browserTerminalClient.ts";
const WIRE_CONTRACT_MODULE = "shared/api/transport/wireContract.ts";
const WIRE_EXPORTS = [
  "buildAttachInit",
  "buildResize",
  "buildScroll",
  "parseError",
  "parseReady",
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

/** Shipping sources plus the dev proxy table, labelled relative to src/. */
function scannedSources(): { label: string; text: string }[] {
  return [
    ...shippingSources(SRC_ROOT).map((path) => ({
      label: relative(SRC_ROOT, path),
      text: readFileSync(path, "utf8"),
    })),
    {
      label: "../vite.proxy.ts",
      text: readFileSync(join(process.cwd(), "vite.proxy.ts"), "utf8"),
    },
  ];
}

function readSource(label: string): string {
  return readFileSync(join(SRC_ROOT, label), "utf8");
}

describe("overhaul acceptance — retired terminal transports", () => {
  it("constructs no terminal REST URL anywhere in shipping Studio source", () => {
    const offenders = scannedSources().flatMap(({ label, text }) =>
      text
        .split("\n")
        .flatMap((line, index) =>
          !isComment(line) && RETIRED_REST_ROUTES.some((route) => line.includes(route))
            ? [`${label}:${index + 1}: ${line.trim()}`]
            : [],
        ),
    );

    expect(offenders).toEqual([]);
  });

  it("addresses exactly one WebSocket route: the canonical attach-only socket", () => {
    // Every literal `/ws/<segment>` path in shipping code, so a renamed or
    // extra socket cannot sneak past unnoticed.
    const routes = scannedSources().flatMap(({ label: _label, text }) =>
      text
        .split("\n")
        .filter((line) => !isComment(line))
        .map((line) => line.match(/\/ws\/[A-Za-z0-9_-]+/)?.[0])
        .filter((route): route is string => Boolean(route)),
    );

    expect([...new Set(routes)]).toEqual([INTENDED_TERMINAL_SOCKET]);
  });

  it("opens a WebSocket in exactly one place: the browser attach client", () => {
    const constructors = scannedSources()
      .filter(({ text }) =>
        text
          .split("\n")
          .some((line) => !isComment(line) && line.includes("new WebSocket(")),
      )
      .map(({ label }) => label);

    expect(constructors).toEqual([INTENDED_WS_CLIENT]);
    expect(readSource(INTENDED_WS_CLIENT)).toContain(
      "new WebSocket(terminalWebSocketUrl())",
    );
  });

  it("keeps the terminal wire contract attach-only with no spawn path", async () => {
    const wireContract = await import("../shared/api/transport/wireContract");

    expect(Object.keys(wireContract).sort()).toEqual(WIRE_EXPORTS);
    expect(wireContract.buildAttachInit("run-1", 120, 40)).toEqual({
      type: "init",
      mode: "attach",
      agent_run_id: "run-1",
      cols: 120,
      rows: 40,
    });
    // Spawn-by-socket belonged to the retired authority; nothing may grow it
    // back into the one frame module.
    expect(readSource(WIRE_CONTRACT_MODULE)).not.toMatch(/spawn/i);
  });

  it("selects the browser attach client wherever the Tauri bridge is absent", async () => {
    const [{ browserTerminalClient }, { terminalClientTransport }] =
      await Promise.all([
        import("../features/agents/terminal/internal/browserTerminalClient"),
        import("../features/agents/terminal/internal/terminalClientRuntime"),
      ]);

    // This acceptance suite runs outside Tauri, so the platform-neutral
    // runtime must have selected the intended WebSocket transport.
    expect(terminalClientTransport).toBe(browserTerminalClient);
  });

  it("forwards only the terminal socket and keeps GraphQL subscriptions on SSE", () => {
    const proxyText = readFileSync(join(process.cwd(), "vite.proxy.ts"), "utf8");

    // One WebSocket upgrade flag in the whole table, attached to the canonical
    // terminal route; every HTTP route, including the SSE subscription entry,
    // stays plain streaming HTTP.
    expect(proxyText.split("\n").filter((line) => !isComment(line) && line.includes("ws: true"))).toHaveLength(1);
    expect(proxyText).toContain('"/ws/terminal"');
    const subscribeEntry = proxyText.slice(
      proxyText.indexOf('"/graphql/subscribe"'),
      proxyText.indexOf('"/graphql"', proxyText.indexOf('"/graphql/subscribe"')),
    );
    expect(subscribeEntry).toContain("target:");
    expect(subscribeEntry).not.toMatch(/ws:\s*true/);
  });
});
