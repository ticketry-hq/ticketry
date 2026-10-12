import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../../config/editions.json", import.meta.url), "utf8"));
const EDITIONS = Object.freeze([...manifest.editions]);
const DEFAULT_EDITION = "pocock";

/** Resolve the compiled edition: Pocock unless TICKETRY_EDITION names an exact edition. */
export function resolveEdition(environment = process.env) {
  const override = environment.TICKETRY_EDITION;
  if (override === undefined) return { edition: DEFAULT_EDITION, source: "default" };
  if (EDITIONS.includes(override)) return { edition: override, source: "explicit" };
  throw new Error(
    `TICKETRY_EDITION must be exactly ${EDITIONS.map((edition) => JSON.stringify(edition)).join(" or ")}; `
    + `received ${JSON.stringify(override)}. Unset it to build the default ${DEFAULT_EDITION} edition.`,
  );
}

/** The Vite/Vitest `define` entries that compile the resolved edition into the frontend. */
export function editionDefine(environment = process.env) {
  return { __TICKETRY_EDITION__: JSON.stringify(resolveEdition(environment).edition) };
}

const EDITION_CARGO_FEATURES = Object.freeze({ pocock: [], core: ["edition-core"] });

/**
 * Plan one launcher or release build of the resolved edition: the Cargo
 * features the Rust host needs, the child environment that makes Vite compile
 * the same edition, and the one log line naming the edition and its source.
 * An invalid TICKETRY_EDITION throws here, before any child process exists.
 */
export function resolveEditionBuild(environment = process.env) {
  const { edition, source } = resolveEdition(environment);
  return {
    edition,
    source,
    cargoFeatures: [...EDITION_CARGO_FEATURES[edition]],
    environment: { ...environment, TICKETRY_EDITION: edition },
    description: `Edition: ${edition} (${source})`,
  };
}

/** `--features` arguments for an edition build, merged with any features the caller already needs. */
export function editionFeatureArguments(build, features = []) {
  const all = [...features, ...build.cargoFeatures];
  return all.length === 0 ? [] : ["--features", all.join(",")];
}
