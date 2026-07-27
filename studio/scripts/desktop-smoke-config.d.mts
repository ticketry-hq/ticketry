export interface DevelopmentSmokeConfiguration {
  webviewUrl: string;
  runtimeEnvironment: Record<string, string>;
}

export function buildDevelopmentSmokeConfiguration(
  port: string,
): DevelopmentSmokeConfiguration;

export function assertDevelopmentEndpointAgreement(
  webviewUrl: string,
  runtimeEnvironment: Record<string, string>,
): void;
