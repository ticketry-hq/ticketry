export interface FeatureSuiteViolation { rule: number; path: string; message: string }
export function checkFeatureSuites(mapDirectory: string, e2eDirectory: string, repositoryRoot: string): FeatureSuiteViolation[];
export function validateFeatureSuites(registry: import("./featureSuites.mjs").FeatureRegistry, existingPaths: Set<string>): FeatureSuiteViolation[];
