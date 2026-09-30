export type StoryMoveLogLevel = "info" | "warn" | "error";

export function storyMoveError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const apollo = error as Error & {
      cause?: unknown;
      graphQLErrors?: Array<{
        message?: unknown;
        path?: unknown;
        extensions?: unknown;
      }>;
      networkError?: unknown;
    };
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: apollo.cause,
      graphQLErrors: apollo.graphQLErrors?.map((failure) => ({
        message: failure.message,
        path: failure.path,
        extensions: failure.extensions,
      })),
      networkError: apollo.networkError instanceof Error
        ? {
            name: apollo.networkError.name,
            message: apollo.networkError.message,
            stack: apollo.networkError.stack,
          }
        : apollo.networkError,
    };
  }
  return { message: String(error) };
}

export function recordStoryMove(
  event: string,
  details: Record<string, unknown>,
  level: StoryMoveLogLevel = "info",
): void {
  console[level]("[story-move]", event, details);
}
