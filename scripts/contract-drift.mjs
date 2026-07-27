import { spawnSync } from "node:child_process";

const differs = (committed, generated, excluded = []) =>
  spawnSync("diff", [
    "-ru",
    ...excluded.flatMap((pattern) => ["-x", pattern]),
    committed,
    generated,
  ], {
    encoding: "utf8",
  }).status !== 0;

export const findStaleContractArtifacts = ({
  committedSchema,
  generatedSchema,
  committedTypescript,
  generatedTypescript,
  committedPython,
  generatedPython,
}) => {
  const stale = [];
  if (differs(committedSchema, generatedSchema)) {
    stale.push("openapi.json");
  }
  if (differs(committedTypescript, generatedTypescript)) {
    stale.push("surfaces/worktracker-typescript-sdk/src/generated");
  }
  if (differs(committedPython, generatedPython, ["__pycache__", "*.pyc"])) {
    stale.push("surfaces/worktracker-sdk/worktracker_sdk/generated");
  }
  return stale;
};
