/** Resolve the compiled frontend choice from the validated build context. */
export function resolveRoadmapAvailability(environment = process.env, { signedRelease = false } = {}) {
  const override = environment.TICKETRY_ROADMAP_ENABLED;
  if (override === undefined) return !signedRelease;
  if (override === "true") return true;
  if (override === "false") return false;
  throw new Error(
    `TICKETRY_ROADMAP_ENABLED must be the literal true or false; received ${JSON.stringify(override)}. `
    + "Unset it to use the build-context default.",
  );
}
