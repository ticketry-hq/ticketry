export interface LaunchDiscoveryIdentity {
  readonly projectId: string | null;
  readonly agentRunId: string | null;
  readonly cursor: number | null;
  readonly connectionGeneration: number | null;
}

export interface LaunchDiscoveryRecorderOptions {
  readonly rendererInstance: string;
  readonly runtimeInstance: string | null;
  readonly now?: () => string;
  readonly write?: (label: string, record: Record<string, unknown>) => void;
}

export interface LaunchDiscoveryRecorder {
  record(
    event: string,
    identity: LaunchDiscoveryIdentity,
    details?: Record<string, unknown>,
  ): void;
  recordForAgentRun(
    event: string,
    projectId: string,
    agentRunId: string,
    details?: Record<string, unknown>,
  ): void;
}

export function createLaunchDiscoveryRecorder({
  rendererInstance,
  runtimeInstance,
  now = () => new Date().toISOString(),
  write = (label, record) => console.info(label, record),
}: LaunchDiscoveryRecorderOptions): LaunchDiscoveryRecorder {
  const identities = new Map<string, LaunchDiscoveryIdentity>();
  const identityKey = (projectId: string, agentRunId: string) =>
    `${projectId}\0${agentRunId}`;
  const record = (
    event: string,
    identity: LaunchDiscoveryIdentity,
    details: Record<string, unknown> = {},
  ) => {
    if (identity.projectId && identity.agentRunId) {
      identities.set(
        identityKey(identity.projectId, identity.agentRunId),
        identity,
      );
    }
    write("[launch-discovery]", {
      ...details,
      event,
      timestamp: now(),
      ...identity,
      rendererInstance,
      runtimeInstance,
    });
  };
  return {
    record,
    recordForAgentRun(event, projectId, agentRunId, details = {}) {
      record(
        event,
        identities.get(identityKey(projectId, agentRunId)) ?? {
          projectId,
          agentRunId,
          cursor: null,
          connectionGeneration: null,
        },
        details,
      );
    },
  };
}

const rendererInstance = crypto.randomUUID();
let runtimeInstance: string | null = null;
let recorder = createLaunchDiscoveryRecorder({
  rendererInstance,
  runtimeInstance,
});

export function setLaunchDiscoveryRuntimeInstance(instance: string | null): void {
  runtimeInstance = instance;
  recorder = createLaunchDiscoveryRecorder({ rendererInstance, runtimeInstance });
}

export function recordLaunchDiscovery(
  event: string,
  identity: LaunchDiscoveryIdentity,
  details?: Record<string, unknown>,
): void {
  recorder.record(event, identity, details);
}

export function recordLaunchDiscoveryForAgentRun(
  event: string,
  projectId: string,
  agentRunId: string,
  details?: Record<string, unknown>,
): void {
  recorder.recordForAgentRun(event, projectId, agentRunId, details);
}

export function launchDiscoveryRendererInstance(): string {
  return rendererInstance;
}
