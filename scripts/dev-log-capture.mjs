import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

import { developmentLogPath } from "./dev-logs.mjs";

const defaultLimitBytes = 1024 * 1024;
const defaultGenerations = 3;
const ansiEscape = /\x1b\[[0-?]*[ -\/]*[@-~]/g;

function rotate(logPath, generations) {
  for (let generation = generations - 1; generation >= 1; generation -= 1) {
    const source = generation === 1 ? logPath : `${logPath}.${generation - 1}`;
    if (!existsSync(source)) continue;
    const destination = `${logPath}.${generation}`;
    if (existsSync(destination)) rmSync(destination);
    renameSync(source, destination);
  }
}

function safeLabel(value) {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-");
}

export function createDevelopmentLogCapture({
  logPath = developmentLogPath,
  stdout = process.stdout,
  stderr = process.stderr,
  now = () => new Date(),
  limitBytes = defaultLimitBytes,
  generations = defaultGenerations,
} = {}) {
  mkdirSync(path.dirname(logPath), { recursive: true });
  appendFileSync(logPath, "", { mode: 0o600 });
  chmodSync(logPath, 0o600);

  let activeBytes = statSync(logPath).size;
  const states = new Map();

  function appendLine(source, channel, line) {
    const cleanLine = line.replace(/\r$/, "").replace(ansiEscape, "");
    const entry = `${now().toISOString()} [${safeLabel(source)}:${channel}] ${cleanLine}\n`;
    const entryBytes = Buffer.byteLength(entry);
    if (activeBytes > 0 && activeBytes + entryBytes > limitBytes) {
      rotate(logPath, generations);
      appendFileSync(logPath, "", { mode: 0o600 });
      chmodSync(logPath, 0o600);
      activeBytes = 0;
    }
    appendFileSync(logPath, entry, { mode: 0o600 });
    activeBytes += entryBytes;
  }

  function stateFor(source, channel) {
    const key = `${source}\0${channel}`;
    let state = states.get(key);
    if (!state) {
      state = {
        channel,
        decoder: new StringDecoder("utf8"),
        pending: "",
        source,
      };
      states.set(key, state);
    }
    return state;
  }

  function write(source, channel, chunk) {
    const destination = channel === "stderr" ? stderr : stdout;
    destination.write(chunk);

    const state = stateFor(source, channel);
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    const parts = `${state.pending}${state.decoder.write(bytes)}`.split("\n");
    state.pending = parts.pop() ?? "";
    for (const line of parts) appendLine(source, channel, line);
  }

  function flush(source, channel) {
    const key = `${source}\0${channel}`;
    const state = states.get(key);
    if (!state) return;
    const remainder = `${state.pending}${state.decoder.end()}`;
    if (remainder) appendLine(source, channel, remainder);
    states.delete(key);
  }

  function flushSource(source) {
    for (const state of [...states.values()]) {
      if (state.source === source) flush(state.source, state.channel);
    }
  }

  function close() {
    for (const state of [...states.values()]) flush(state.source, state.channel);
  }

  return { close, flush, flushSource, logPath, write };
}
