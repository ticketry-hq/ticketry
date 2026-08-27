import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  removeTemporarySqliteProfile,
  stopTemporaryTmuxServer,
} from "../studio/scripts/desktop-dev.mjs";

export function processIsAlive(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function watchTemporaryProfile({
  dataDirectory,
  parentProcessId,
  tmuxSocket,
  isAlive = processIsAlive,
  schedule = setTimeout,
  cleanup = removeTemporarySqliteProfile,
  stopTmux = stopTemporaryTmuxServer,
  profileExists = existsSync,
} = {}) {
  const poll = () => {
    if (isAlive(parentProcessId)) {
      schedule(poll, 250);
      return;
    }
    if (profileExists(dataDirectory)) cleanup(dataDirectory);
    stopTmux(tmuxSocket);
  };
  poll();
}

function main() {
  const [dataDirectory, parentProcessIdValue, tmuxSocket] = process.argv.slice(2);
  const parentProcessId = Number(parentProcessIdValue);
  if (
    !dataDirectory ||
    !Number.isInteger(parentProcessId) ||
    parentProcessId < 1 ||
    !tmuxSocket
  ) {
    throw new Error("usage: temporary-profile-watchdog <profile> <parent-pid> <tmux-socket>");
  }
  watchTemporaryProfile({ dataDirectory, parentProcessId, tmuxSocket });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch {
    process.exitCode = 1;
  }
}
