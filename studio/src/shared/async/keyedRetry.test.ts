import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeyedRetryService } from "./keyedRetry";

const options = {
  maxRetries: 3,
  initialDelayMs: 100,
  backoffMultiplier: 2,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("KeyedRetryService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shares one active operation for the same key and generation", async () => {
    const service = new KeyedRetryService<string, number, string>();
    const result = deferred<string>();
    const operation = vi.fn(() => result.promise);

    const first = service.schedule("story-1", 7, operation, options);
    const duplicate = service.schedule("story-1", 7, operation, options);

    expect(duplicate).toBe(first);
    expect(operation).toHaveBeenCalledTimes(1);

    result.resolve("reconciled");
    await expect(first).resolves.toBe("reconciled");

    await expect(
      service.schedule("story-1", 7, operation, options),
    ).resolves.toBe("reconciled");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("performs one initial attempt plus the configured exponential retries", async () => {
    const service = new KeyedRetryService<string, number, string>();
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("second"))
      .mockRejectedValueOnce(new Error("third"))
      .mockResolvedValue("reconciled");

    const scheduled = service.schedule("story-1", 7, operation, options);
    expect(operation).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(99);
    expect(operation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(operation).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(200);
    expect(operation).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(400);
    expect(operation).toHaveBeenCalledTimes(4);
    await expect(scheduled).resolves.toBe("reconciled");
  });

  it("rejects with the final failure after retry exhaustion", async () => {
    const service = new KeyedRetryService<string, number, string>();
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("second"))
      .mockRejectedValueOnce(new Error("final"));

    const scheduled = service.schedule("story-1", 7, operation, {
      ...options,
      maxRetries: 2,
    });
    const exhausted = expect(scheduled).rejects.toThrow("final");

    await vi.advanceTimersByTimeAsync(300);

    await exhausted;
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("cancels in-flight work for one key as an abort", async () => {
    const service = new KeyedRetryService<string, number, string>();
    const result = deferred<string>();
    let operationSignal: AbortSignal | undefined;
    const scheduled = service.schedule(
      "story-1",
      7,
      (signal) => {
        operationSignal = signal;
        return result.promise;
      },
      options,
    );
    const cancelled = expect(scheduled).rejects.toMatchObject({
      name: "AbortError",
    });

    service.cancel("story-1");

    expect(operationSignal?.aborted).toBe(true);
    await cancelled;
    result.resolve("too late");
  });

  it("cancels a pending backoff timer without another attempt", async () => {
    const service = new KeyedRetryService<string, number, string>();
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new Error("offline"));
    const scheduled = service.schedule("story-1", 7, operation, options);
    const cancelled = expect(scheduled).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);

    service.cancel("story-1");

    expect(vi.getTimerCount()).toBe(0);
    await cancelled;
    await vi.runAllTimersAsync();
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("cancels all active keys", async () => {
    const service = new KeyedRetryService<string, number, string>();
    const results = [deferred<string>(), deferred<string>()];
    const signals: AbortSignal[] = [];
    const scheduled = results.map((result, index) =>
      service.schedule(
        `story-${index + 1}`,
        7,
        (signal) => {
          signals.push(signal);
          return result.promise;
        },
        options,
      ),
    );
    const cancellations = scheduled.map((promise) =>
      expect(promise).rejects.toMatchObject({ name: "AbortError" }),
    );

    service.cancelAll();

    expect(signals.every((signal) => signal.aborted)).toBe(true);
    await Promise.all(cancellations);
  });

  it("replaces an older generation and shares the newer operation", async () => {
    const service = new KeyedRetryService<string, number, string>();
    let oldSignal: AbortSignal | undefined;
    const oldOperation = vi.fn((signal: AbortSignal) => {
      oldSignal = signal;
      return Promise.reject(new Error("old truth unavailable"));
    });
    const old = service.schedule(
      "story-1",
      7,
      oldOperation,
      options,
    );
    const oldCancelled = expect(old).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    const newResult = deferred<string>();
    const newOperation = vi.fn(() => newResult.promise);

    const replacement = service.schedule("story-1", 8, newOperation, options);
    const duplicate = service.schedule("story-1", 8, newOperation, options);

    expect(oldSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(duplicate).toBe(replacement);
    expect(oldOperation).toHaveBeenCalledTimes(1);
    expect(newOperation).toHaveBeenCalledTimes(1);
    await oldCancelled;
    newResult.resolve("new truth");
    await expect(replacement).resolves.toBe("new truth");
  });
});
