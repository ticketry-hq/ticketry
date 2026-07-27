import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";

const identityPrefix = "MUXED_DEVELOPMENT_IDENTITY ";

function waitForIdentity(child, name, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lines = readline.createInterface({ input: child.stdout });
    const timeout = setTimeout(() => {
      lines.close();
      reject(new Error(`${name} did not report its development identity`));
    }, timeoutMs);
    const fail = (error) => {
      clearTimeout(timeout);
      lines.close();
      reject(error);
    };
    child.once("error", fail);
    child.once("exit", (code, signal) => {
      fail(new Error(`${name} exited before ready (${code ?? signal})`));
    });
    lines.on("line", (line) => {
      if (!line.startsWith(identityPrefix)) return;
      clearTimeout(timeout);
      lines.close();
      try {
        resolve(JSON.parse(line.slice(identityPrefix.length)));
      } catch (error) {
        reject(new Error(`${name} reported an invalid development identity: ${error.message}`));
      }
    });
  });
}

async function fetchText(url, options, name) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}`);
  return response.text();
}

function stop(child, name, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${name} did not stop independently`));
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function observe(instance) {
  const frontendMarker = await fetchText(instance.identity.frontend, {}, `${instance.name} frontend`);
  const backendOwner = await fetchText(
    `${instance.identity.backend}/owner`,
    { headers: { Origin: instance.identity.frontend } },
    `${instance.name} backend`,
  );
  const mcpOwner = await fetchText(
    `${instance.identity.mcp}/mcp`,
    { method: "POST", body: "{}" },
    `${instance.name} MCP`,
  );
  return { ...instance.identity, frontendMarker, backendOwner, mcpOwner };
}

export async function runConcurrentDevelopmentSmoke({
  fixtures,
  command,
  args = [],
  timeoutMs = 30_000,
}) {
  if (fixtures.length !== 2) throw new Error("concurrent smoke requires exactly two fixtures");
  await Promise.all(fixtures.flatMap((fixture) => [
    mkdir(fixture.cwd, { recursive: true }),
    mkdir(fixture.dataDirectory, { recursive: true }),
  ]));

  const instances = fixtures.map((fixture) => {
    const child = spawn(command, args, {
      cwd: fixture.cwd,
      env: {
        ...process.env,
        MUXED_SMOKE_FIXTURE_NAME: fixture.name,
        MUXED_DATA_DIR: fixture.dataDirectory,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ...fixture, child };
  });

  try {
    const identities = await Promise.all(instances.map(async (instance) => ({
      ...instance,
      identity: await waitForIdentity(instance.child, instance.name, timeoutMs),
    })));
    const [first, second] = await Promise.all(identities.map(observe));
    for (const [index, observed] of [first, second].entries()) {
      const fixture = fixtures[index];
      if (observed.frontendMarker !== fixture.name) {
        throw new Error(`${fixture.name} loaded another fixture's frontend`);
      }
      if (observed.backendOwner !== fixture.name || observed.mcpOwner !== fixture.name) {
        throw new Error(`${fixture.name} reached services owned by another instance`);
      }
      if (observed.dataDirectory !== fixture.dataDirectory) {
        throw new Error(`${fixture.name} reported another data directory`);
      }
    }
    for (const field of ["frontend", "backend", "mcp", "dataDirectory"]) {
      if (first[field] === second[field]) throw new Error(`instances share ${field}`);
    }
    const crossedBackend = await fetch(`${first.backend}/owner`, {
      headers: { Origin: second.frontend },
    });
    if (crossedBackend.status !== 403) {
      throw new Error("one instance's frontend was accepted by another instance's backend");
    }

    const sentinel = path.join(first.dataDirectory, `${first.frontendMarker}-sentinel`);
    await writeFile(sentinel, first.frontendMarker);
    await stop(identities[0].child, identities[0].name, timeoutMs);
    const survivor = await observe(identities[1]);

    return {
      [identities[0].name]: first,
      [identities[1].name]: second,
      survivorAfterFirstShutdown: survivor.frontendMarker,
    };
  } finally {
    await Promise.all(instances.map((instance) => stop(instance.child, instance.name, timeoutMs)));
  }
}
