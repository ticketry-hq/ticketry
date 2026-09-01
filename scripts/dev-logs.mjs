import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  truncateSync,
  unlinkSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  buildLaunchTraceReport,
  parseLaunchTraceRecords,
  renderLaunchTraceReport,
} from "./launch-trace-report.mjs";

export const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
export const developmentLogPath = path.join(
  workspaceRoot,
  ".ticketry-dev",
  "logs",
  "ticketry.log",
);

const retainedGenerations = 3;

export function developmentLogPaths(logPath = developmentLogPath) {
  const paths = [logPath];
  for (let generation = 1; generation < retainedGenerations; generation += 1) {
    paths.push(`${logPath}.${generation}`);
  }
  return paths;
}

function ensureActiveLog(logPath = developmentLogPath) {
  mkdirSync(path.dirname(logPath), { recursive: true });
  if (!existsSync(logPath)) closeSync(openSync(logPath, "a", 0o600));
}

export function recentLogLines({ logPath = developmentLogPath, limit = 200 } = {}) {
  const chronologicalPaths = developmentLogPaths(logPath).reverse();
  const lines = chronologicalPaths.flatMap((candidate) => {
    if (!existsSync(candidate)) return [];
    return readFileSync(candidate, "utf8").split(/\r?\n/).filter(Boolean);
  });
  return limit === Infinity ? lines : lines.slice(-Math.max(0, limit));
}

export function clearDevelopmentLogs(logPath = developmentLogPath) {
  ensureActiveLog(logPath);
  truncateSync(logPath, 0);
  for (const rotated of developmentLogPaths(logPath).slice(1)) {
    if (existsSync(rotated)) unlinkSync(rotated);
  }
}

export function launchTraceReportFromLog(
  launchTraceIdentity,
  logPath = developmentLogPath,
) {
  const records = parseLaunchTraceRecords(
    recentLogLines({ logPath, limit: Infinity }),
    launchTraceIdentity,
  );
  if (records.length === 0) {
    throw new Error(
      `no launch-discovery records found for launch trace identity ${launchTraceIdentity}; ` +
        `no launch-discovery records found for Agent Run ${launchTraceIdentity} or launch attempt ${launchTraceIdentity}`,
    );
  }
  return renderLaunchTraceReport(
    launchTraceIdentity,
    buildLaunchTraceReport(records),
    { label: "Launch trace" },
  );
}

function showLogs() {
  const lines = recentLogLines();
  if (lines.length > 0) process.stdout.write(`${lines.join("\n")}\n`);
}

function followLogs() {
  ensureActiveLog();
  showLogs();
  let offset = statSync(developmentLogPath).size;
  const interval = setInterval(() => {
    const contents = readFileSync(developmentLogPath);
    if (contents.length < offset) offset = 0;
    if (contents.length > offset) {
      process.stdout.write(contents.subarray(offset));
      offset = contents.length;
    }
  }, 250);
  const stop = () => {
    clearInterval(interval);
    process.exitCode = 0;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

function main(command = "show") {
  switch (command) {
    case "show":
      showLogs();
      break;
    case "path":
      process.stdout.write(`${developmentLogPath}\n`);
      break;
    case "clear":
      clearDevelopmentLogs();
      process.stdout.write(`Cleared Ticketry development logs: ${developmentLogPath}\n`);
      break;
    case "follow":
      followLogs();
      break;
    case "trace": {
      const launchTraceIdentity = process.argv[3];
      if (!launchTraceIdentity) {
        throw new Error(
          "usage: npm run logs:trace -- <launch-trace-identity>",
        );
      }
      process.stdout.write(`${launchTraceReportFromLog(launchTraceIdentity)}\n`);
      break;
    }
    default:
      throw new Error(`unknown development log command: ${command}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv[2]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
