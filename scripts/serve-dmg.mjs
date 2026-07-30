#!/usr/bin/env node

import { createReadStream, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultReleaseDirectory = join(repositoryRoot, "studio", "release-output");

function usage() {
  return `Usage: npm run serve:dmg -- [path/to/file.dmg] [--host ADDRESS] [--port PORT]

Serves exactly one DMG over the local network. If no path is supplied, the
newest DMG under studio/release-output is selected automatically.

Options:
  --host ADDRESS  LAN address to bind (default: first private IPv4 address)
  --port PORT     TCP port to listen on (default: 8000)
  --help          Show this help`;
}

export function privateLanAddresses(interfaces = networkInterfaces()) {
  const addresses = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (
        entry.family === "IPv4" &&
        !entry.internal &&
        isPrivateIpv4(entry.address)
      ) {
        addresses.push({ address: entry.address, name });
      }
    }
  }

  return addresses.sort((left, right) => {
    const preferred = (name) =>
      name === "en0" ? 0 : name === "en1" ? 1 : name.startsWith("en") ? 2 : 3;
    return preferred(left.name) - preferred(right.name);
  });
}

function isPrivateIpv4(address) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return false;
  }

  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function findDmgs(directory) {
  const matches = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...findDmgs(entryPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".dmg")) {
      matches.push(entryPath);
    }
  }

  return matches;
}

export function newestReleaseDmg(directory = defaultReleaseDirectory) {
  const matches = findDmgs(directory);
  matches.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  return matches[0];
}

export function parseArguments(argv) {
  const options = {
    dmgPath: undefined,
    host: undefined,
    port: 8000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--host") {
      options.host = argv[++index];
      if (!options.host) throw new Error("--host requires an address");
    } else if (argument === "--port") {
      const value = argv[++index];
      options.port = Number(value);
      if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
        throw new Error("--port must be an integer between 0 and 65535");
      }
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (options.dmgPath) {
      throw new Error("Only one DMG path may be supplied");
    } else {
      options.dmgPath = resolve(argument);
    }
  }

  return options;
}

function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value ?? "");
  if (!match) return undefined;

  let start;
  let end;
  if (match[1] === "") {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return undefined;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Number(match[2]);
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    return undefined;
  }

  return { start, end: Math.min(end, size - 1) };
}

export function createDmgServer(dmgPath) {
  const absolutePath = resolve(dmgPath);
  const file = statSync(absolutePath);
  if (!file.isFile() || !absolutePath.toLowerCase().endsWith(".dmg")) {
    throw new Error(`Not a DMG file: ${absolutePath}`);
  }

  const filename = basename(absolutePath);
  const downloadPath = `/${encodeURIComponent(filename)}`;
  const commonHeaders = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="${filename.replaceAll('"', "")}"`,
    "Content-Type": "application/x-apple-diskimage",
    "X-Content-Type-Options": "nosniff",
  };

  const server = createServer((request, response) => {
    const requestPath = new URL(request.url ?? "/", "http://localhost").pathname;
    if (
      requestPath !== downloadPath ||
      (request.method !== "GET" && request.method !== "HEAD")
    ) {
      response.writeHead(404, {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      });
      response.end("Not found\n");
      return;
    }

    const rangeHeader = request.headers.range;
    const range = rangeHeader ? parseRange(rangeHeader, file.size) : undefined;
    if (rangeHeader && !range) {
      response.writeHead(416, {
        ...commonHeaders,
        "Content-Range": `bytes */${file.size}`,
      });
      response.end();
      return;
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? file.size - 1;
    response.writeHead(range ? 206 : 200, {
      ...commonHeaders,
      "Content-Length": end - start + 1,
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${file.size}` } : {}),
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    const stream = createReadStream(absolutePath, { start, end });
    stream.on("error", (error) => {
      console.error(`DMG read failed: ${error.message}`);
      response.destroy(error);
    });
    stream.pipe(response);
  });

  return { downloadPath, filename, server, size: file.size };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(usage());
    return;
  }

  const dmgPath = options.dmgPath ?? newestReleaseDmg();
  if (!dmgPath) {
    throw new Error(
      "No DMG found under studio/release-output. Build a release or pass a DMG path.",
    );
  }

  const detectedAddresses = privateLanAddresses();
  const host = options.host ?? detectedAddresses[0]?.address;
  if (!host) {
    throw new Error(
      "No private LAN IPv4 address found. Connect to the LAN or pass --host explicitly.",
    );
  }

  const { downloadPath, filename, server, size } = createDmgServer(dmgPath);
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port, host, resolveListen);
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  console.log(`Serving only: ${filename} (${(size / 1024 / 1024).toFixed(1)} MiB)`);
  console.log(`LAN download: http://${host}:${port}${downloadPath}`);
  console.log("Press Ctrl+C to stop.");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`serve:dmg: ${error.message}`);
    process.exitCode = 1;
  });
}
