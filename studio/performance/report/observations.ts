import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { ARTIFACTS } from "./schema.mjs";

/**
 * One scenario's raw observations on their way to disk.
 *
 * Raw samples are kept alongside the summary, and a failed or timed-out
 * repetition is recorded rather than dropped: a scenario that only ever
 * publishes its successes is not measuring the application, it is measuring
 * the subset of it that worked.
 */
export class ScenarioRecorder {
  readonly scenario: string;
  readonly engine: string;
  readonly directory: string;
  private readonly timings = new Map<string, number[]>();
  private readonly failures: string[] = [];
  private readonly batches: Record<string, unknown>[] = [];
  private readonly captures: Record<string, unknown> = {};
  private parameters: Record<string, unknown> = {};
  private probes: unknown = null;
  private operationWindows: Record<string, unknown> = {};
  private pageErrors: unknown = null;
  private status: "passed" | "failed" = "passed";

  constructor(
    { scenario, engine, directory }: {
      scenario: string;
      engine: string;
      directory: string;
    },
  ) {
    this.scenario = scenario;
    this.engine = engine;
    this.directory = directory;
  }

  describe(parameters: Record<string, unknown>): void {
    this.parameters = { ...this.parameters, ...parameters };
  }

  /**
   * End-to-end automation latency: runner action dispatch to asserted ready
   * state, on Node's monotonic clock. It includes Playwright dispatch and
   * assertion overhead, and is neither INP nor a paint measurement.
   */
  async time<T>(name: string, action: () => Promise<T>): Promise<T> {
    const started = process.hrtime.bigint();
    try {
      const result = await action();
      this.record(name, Number(process.hrtime.bigint() - started) / 1e6);
      return result;
    } catch (error) {
      this.record(`${name}.failed`, Number(process.hrtime.bigint() - started) / 1e6);
      this.fail(`${name}: ${(error as Error).message}`);
      throw error;
    }
  }

  record(name: string, milliseconds: number): void {
    const samples = this.timings.get(name) ?? [];
    samples.push(milliseconds);
    this.timings.set(name, samples);
  }

  fail(reason: string): void {
    this.status = "failed";
    if (this.failures.length < 50) this.failures.push(reason);
  }

  addBatch(batch: Record<string, unknown>): void {
    this.batches.push(batch);
  }

  addCapture(name: string, value: unknown): void {
    this.captures[name] = value;
  }

  setProbes(snapshot: unknown): void {
    this.probes = snapshot;
  }

  setOperations(windows: Record<string, unknown>): void {
    this.operationWindows = windows;
  }

  setPageErrors(totals: unknown): void {
    this.pageErrors = totals;
  }

  toJSON(extra: Record<string, unknown> = {}) {
    return {
      scenario: this.scenario,
      engine: this.engine,
      status: this.status,
      parameters: this.parameters,
      timings: Object.fromEntries(this.timings),
      probes: this.probes,
      operationWindows: this.operationWindows,
      pageErrors: this.pageErrors,
      batches: this.batches.length > 0 ? this.batches : undefined,
      captures: this.captures,
      failures: this.failures,
      ...extra,
    };
  }

  async write(extra: Record<string, unknown> = {}): Promise<string> {
    await mkdir(this.directory, { recursive: true });
    const file = path.join(this.directory, ARTIFACTS.observations);
    await writeFile(file, `${JSON.stringify(this.toJSON(extra), null, 2)}\n`);
    return file;
  }
}
