import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  BROWSER_DEFAULT_TERMINAL_RENDERER,
  DESKTOP_DEFAULT_TERMINAL_RENDERER,
  RENDERER_STORAGE_KEY,
  selectedTerminalRenderer,
} from "../features/agents/terminal/internal/rendererSelection";

const TERMINAL_FEATURE = `${process.cwd()}/src/features/agents/terminal`;

// Spelled in pieces so the scan below does not flag the file performing it.
const ARCHIVED_RENDERER = ["ghostty", "wasm"].join("-");
const ARCHIVED_COMPONENT = ["Ghostty", "Wasm", "Terminal"].join("");
const ARCHIVED_LIBRARY = ["ghostty", "vt"].join("-");
const ARCHIVED_ARTIFACT_COMMAND = ["desktop", "ghostty", "vt", "artifact"].join("_");
/** The renderer's source lives here now, and only here. */
const ARCHIVE_BRANCH = `archive/CODING-1487-${ARCHIVED_RENDERER}`;

function storage(value: string) {
  return { getItem: (key: string) => (key === RENDERER_STORAGE_KEY ? value : null) };
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx|js|jsx|css|json|graphql)$/.test(entry.name) ? [path] : [];
    }),
  );
  return found.flat();
}

describe("terminal renderer policy acceptance", () => {
  it(
    "[overhaul-269] Desktop builds render terminals with embedded native libghostty and browser " +
      "development renders with xterm over the WebSocket adapter; the archived Ghostty WASM " +
      "renderer is absent from source, build hooks, and selectable overrides",
    async () => {
      expect(DESKTOP_DEFAULT_TERMINAL_RENDERER).toBe("native");
      expect(BROWSER_DEFAULT_TERMINAL_RENDERER).toBe("xterm");

      // Neither a launch flag nor a stored setting can name the archived
      // renderer, on either surface, packaged or in development.
      for (const desktop of [true, false]) {
        for (const developmentBuild of [true, false]) {
          expect(
            selectedTerminalRenderer({
              search: `?terminalRenderer=${ARCHIVED_RENDERER}`,
              storage: storage(ARCHIVED_RENDERER),
              developmentBuild,
              desktop,
            }),
          ).toBe(desktop ? "native" : "xterm");
        }
      }

      await expect(readdir(`${TERMINAL_FEATURE}/${ARCHIVED_RENDERER}`)).rejects.toThrow();

      const files = await sourceFiles(`${process.cwd()}/src`);
      expect(files.length).toBeGreaterThan(0);
      const offenders: string[] = [];
      await Promise.all(
        files.map(async (path) => {
          const text = await readFile(path, "utf8");
          // The component and the artifact command exist only if the renderer
          // does, and no module path may resolve into the archived tree.
          const forbidden = [
            ARCHIVED_COMPONENT,
            ARCHIVED_ARTIFACT_COMMAND,
            `${ARCHIVED_RENDERER}/`,
          ];
          // Removal contracts have to name what they forbid; product source
          // may only name the branch the renderer was archived onto.
          if (!/\.test\.tsx?$/.test(path)) {
            forbidden.push(ARCHIVED_RENDERER, ARCHIVED_LIBRARY);
          }
          const scanned = text.split(ARCHIVE_BRANCH).join("");
          for (const needle of forbidden) {
            if (scanned.includes(needle)) offenders.push(`${path}: ${needle}`);
          }
        }),
      );
      expect(offenders).toEqual([]);

      // A browser terminal renders with xterm, which draws from the pooled
      // WebSocket transport rather than a Tauri channel.
      expect(
        selectedTerminalRenderer({ developmentBuild: true, desktop: false, search: "" }),
      ).toBe("xterm");
      const clientRuntime = await readFile(
        `${TERMINAL_FEATURE}/internal/terminalClientRuntime.ts`,
        "utf8",
      );
      expect(clientRuntime).toContain(
        'import { browserTerminalClient } from "./browserTerminalClient"',
      );
      expect(clientRuntime).toMatch(
        /isTauri\(\)\s*\?\s*tauriTerminalClient\s*:\s*browserTerminalClient/,
      );
      const browserClient = await readFile(
        `${TERMINAL_FEATURE}/internal/browserTerminalClient.ts`,
        "utf8",
      );
      expect(browserClient).toContain("WebSocket");

      // Normal native output never reaches the WebView. Output bytes cross IPC
      // only on the pooled Tauri channel, the pool is opened only by a driver,
      // and the only driver is the xterm surface, which the native path does
      // not mount. Control messages over `invoke` are a separate matter: the
      // native renderer still sends lifecycle, geometry, visibility and focus.
      const transportImporters = files.filter((path) =>
        // Product source only: test harnesses legitimately mock the transport.
        !path.startsWith(`${process.cwd()}/src/test/`) &&
        !/\.test\.tsx?$/.test(path) &&
        !path.endsWith("/internal/terminalClientRuntime.ts"),
      );
      const importsTransport = await Promise.all(
        transportImporters.map(async (path) =>
          (await readFile(path, "utf8")).includes("terminalClientTransport")
            ? path
            : null,
        ),
      );
      expect(importsTransport.filter(Boolean)).toEqual([
        `${TERMINAL_FEATURE}/internal/entryPool.ts`,
      ]);

      const nativeTerminal = await readFile(
        `${TERMINAL_FEATURE}/NativeGhosttyTerminal.tsx`,
        "utf8",
      );
      expect(nativeTerminal).not.toContain("entryPool");
      expect(nativeTerminal).not.toContain("terminalClientTransport");

      // The presenter never touches the pool: xterm and its pool load only
      // through the lazy XtermTerminal chunk, so desktop builds rendering with
      // native libghostty never download the compatibility renderer.
      const terminal = await readFile(`${TERMINAL_FEATURE}/Terminal.tsx`, "utf8");
      expect(terminal).not.toContain("entryPool");
      expect(terminal).not.toContain("xterm/css");
      const xtermTerminal = await readFile(
        `${TERMINAL_FEATURE}/XtermTerminal.tsx`,
        "utf8",
      );
      const driverCalls = xtermTerminal.match(/registerPoolDriver\(\)/g) ?? [];
      expect(driverCalls).toHaveLength(1);
    },
  );
});
