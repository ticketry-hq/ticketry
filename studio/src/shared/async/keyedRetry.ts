export type RetryOperation<T> = (signal: AbortSignal) => Promise<T>;

export interface KeyedRetryOptions {
  readonly maxRetries: number;
  readonly initialDelayMs: number;
  readonly backoffMultiplier: number;
}

interface ActiveEntry<Generation, Result> {
  generation: Generation;
  controller: AbortController;
  promise: Promise<Result>;
}

function cancellationError(signal: AbortSignal): DOMException {
  return signal.reason instanceof DOMException && signal.reason.name === "AbortError"
    ? signal.reason
    : new DOMException("Retry cancelled", "AbortError");
}

export class KeyedRetryService<Key, Generation, Result> {
  private readonly active = new Map<Key, ActiveEntry<Generation, Result>>();

  schedule(
    key: Key,
    generation: Generation,
    operation: RetryOperation<Result>,
    options: KeyedRetryOptions,
  ): Promise<Result> {
    const current = this.active.get(key);
    if (current && Object.is(current.generation, generation)) {
      return current.promise;
    }
    if (current) this.cancel(key);

    const controller = new AbortController();
    const operationPromise = this.execute(operation, options, controller.signal);

    let entry: ActiveEntry<Generation, Result>;
    const promise = operationPromise.finally(() => {
      if (this.active.get(key) === entry) this.active.delete(key);
    });
    entry = { generation, controller, promise };
    this.active.set(key, entry);
    return promise;
  }

  cancel(key: Key): void {
    const entry = this.active.get(key);
    if (!entry) return;
    this.active.delete(key);
    entry.controller.abort(new DOMException("Retry cancelled", "AbortError"));
  }

  cancelAll(): void {
    for (const key of [...this.active.keys()]) this.cancel(key);
  }

  private async execute<T>(
    operation: RetryOperation<T>,
    options: KeyedRetryOptions,
    signal: AbortSignal,
  ): Promise<T> {
    let retries = 0;
    while (true) {
      try {
        return await this.runOperation(operation, signal);
      } catch (error) {
        if (signal.aborted) throw cancellationError(signal);
        if (retries >= options.maxRetries) throw error;
        const delayMs =
          options.initialDelayMs * options.backoffMultiplier ** retries;
        retries += 1;
        await this.delay(delayMs, signal);
      }
    }
  }

  private runOperation<T>(
    operation: RetryOperation<T>,
    signal: AbortSignal,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal.aborted) {
        reject(cancellationError(signal));
        return;
      }

      const onAbort = () => reject(cancellationError(signal));
      signal.addEventListener("abort", onAbort, { once: true });

      let result: Promise<T>;
      try {
        result = operation(signal);
      } catch (error) {
        result = Promise.reject(error);
      }
      result.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  }

  private delay(delayMs: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(cancellationError(signal));
        return;
      }

      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, delayMs);
      const onAbort = () => {
        clearTimeout(timer);
        reject(cancellationError(signal));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}
