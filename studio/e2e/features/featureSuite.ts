import { test } from "@playwright/test";

export interface FeatureSuiteOptions {
  test?: Pick<typeof test, "describe">;
  isolation?: "suite" | "case";
  profile?: "onboarded" | "first-run";
}

export function featureSuite(id: string, body: () => void): void;
export function featureSuite(id: string, options: FeatureSuiteOptions, body: () => void): void;
export function featureSuite(id: string, optionsOrBody: FeatureSuiteOptions | (() => void), body?: () => void): void {
  const options = typeof optionsOrBody === "function" ? {} : optionsOrBody;
  const suiteBody = typeof optionsOrBody === "function" ? optionsOrBody : body!;
  (options.test ?? test).describe(id, { tag: `@feature-${id}` }, suiteBody);
}
