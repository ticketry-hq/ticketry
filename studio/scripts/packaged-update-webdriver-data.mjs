import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { executeWebviewRequest } from "./packaged-update-webdriver-boundaries.mjs";

const STORAGE_VALUES = {
  "studio.recentModule:v1": "packaged-update-acceptance-module",
  "studio.sidebarVisible:v2": "false",
};
const APPROVED_EXECUTABLES = {
  tools: [
    { path: "/usr/bin/false", tool: "codex" },
    { path: "/usr/bin/false", tool: "tmux" },
  ],
};
const LOGIN_FIXTURES = [
  ["codex", ".codex/auth.json"],
  ["claude", ".claude/.credentials.json"],
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeIfMissing(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await writeFile(filePath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
}

export function createPackagedUpdateDataAdapter({
  dataDirectory,
  home,
  currentSession,
  boundaries,
  disconnectedError,
}) {
  const approvedPath = path.join(dataDirectory, "approved-executables.json");
  const loginPaths = Object.fromEntries(
    LOGIN_FIXTURES.map(([provider, relative]) => [provider, path.join(home, relative)]),
  );

  async function inspectCurrent() {
    const session = currentSession();
    if (!session) throw disconnectedError();
    const [workTracker, selectedWorkspace, preferences, storage, approved, ...loginContents] =
      await Promise.all([
        boundaries.sqliteDump(path.join(dataDirectory, "state.db"), "worktracker_*"),
        boundaries.sqliteDump(path.join(dataDirectory, "state.db"), "module_links"),
        boundaries.sqliteDump(path.join(dataDirectory, "state.db"), "app_settings"),
        executeWebviewRequest(session, {
          kind: "storage-read",
          keys: Object.keys(STORAGE_VALUES),
        }),
        readFile(approvedPath, "utf8"),
        ...Object.values(loginPaths).map((filePath) => readFile(filePath)),
      ]);
    return {
      workTracker: sha256(workTracker),
      selectedWorkspace: {
        database: sha256(selectedWorkspace),
        recentModule: storage["studio.recentModule:v1"],
      },
      preferences: {
        database: sha256(preferences),
        sidebarVisible: storage["studio.sidebarVisible:v2"],
      },
      approvedExecutablePaths: JSON.parse(approved),
      compatibleAgentLoginState: Object.fromEntries(
        Object.keys(loginPaths).map((provider, index) => [provider, sha256(loginContents[index])]),
      ),
    };
  }

  return {
    async seedVersionA() {
      const session = currentSession();
      if (!session) throw disconnectedError();
      await Promise.all([
        writeIfMissing(approvedPath, `${JSON.stringify(APPROVED_EXECUTABLES, null, 2)}\n`),
        ...Object.values(loginPaths).map((filePath) =>
          writeIfMissing(filePath, `${JSON.stringify({ token: "acceptance-token" })}\n`)),
        executeWebviewRequest(session, { kind: "storage-write", values: STORAGE_VALUES }),
      ]);
      return inspectCurrent();
    },
    inspectCurrent,
  };
}
