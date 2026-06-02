import { createGpuAdapter } from "./gpu";
import { getTransformedFunction } from "./internal";
import { createScheduler } from "./scheduler";
import { runFunctionInWorker } from "./worker";
import type {
  FunctionWorkerOptions,
  GpuComputeJob,
  RinganFunction,
  RinganOptions,
  RinganRunOptions,
  RinganRunner,
  SchedulerOptions
} from "./types";

function isOptionsLike(value: unknown): value is RinganOptions {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<RinganOptions>;
  return (
    "mode" in candidate ||
    "worker" in candidate ||
    "signal" in candidate ||
    "frameBudget" in candidate ||
    "useIdleCallback" in candidate ||
    "onProgress" in candidate
  );
}

// Oro? ringan.worker(fn, options) carries FunctionWorkerOptions, but its keys
// (WorkerCtor / size / workerUrlFactory / revokeWorkerUrl) sessha did not teach
// isOptionsLike to see, de gozaru. This one watches for them here, so the second
// argument is honored as options-dono and not mistaken for the worker input.
// Scheduler-ish keys are welcomed too, that they are.
function isWorkerOptionsLike(value: unknown): value is FunctionWorkerOptions & RinganRunOptions {
  if (!value || typeof value !== "object") {
    return false;
  }
  return (
    isOptionsLike(value) ||
    "WorkerCtor" in value ||
    "size" in value ||
    "workerUrlFactory" in value ||
    "revokeWorkerUrl" in value ||
    "transfer" in value
  );
}

function mergeRunOptions(base: RinganOptions, runOptions?: RinganRunOptions): RinganOptions & RinganRunOptions {
  return {
    ...base,
    ...runOptions,
    signal: runOptions?.signal ?? base.signal,
    frameBudget: runOptions?.frameBudget ?? base.frameBudget,
    useIdleCallback: runOptions?.useIdleCallback ?? base.useIdleCallback,
    onProgress: runOptions?.onProgress ?? base.onProgress
  };
}

function createRunner<I, O>(fn: RinganFunction<I, O>, options: RinganOptions = {}): RinganRunner<I, O> {
  return async function ringanRunner(this: unknown, input: I, runOptions?: RinganRunOptions): Promise<Awaited<O>> {
    const merged = mergeRunOptions(options, runOptions);
    const mode = merged.mode ?? "auto";

    if (mode === "worker") {
      return runFunctionInWorker(fn, input, normalizeFunctionWorkerOptions(merged));
    }

    const scheduler = createScheduler(merged);
    const context = scheduler.createContext(merged);
    const transformed = getTransformedFunction(fn);

    if (transformed) {
      return transformed.call(this, input, context);
    }

    if (mode === "cooperative") {
      return (await fn.call(this, input, context)) as Awaited<O>;
    }

    if (merged.worker) {
      return runFunctionInWorker(fn, input, normalizeFunctionWorkerOptions(merged));
    }

    throw new Error(
      "Ringan cannot make this function lightweight at runtime. Enable ringanPlugin() for build-time loop splitting, pass mode: \"cooperative\" and call context.yield(), or use mode: \"worker\" for worker-safe functions."
    );
  };
}

function normalizeFunctionWorkerOptions(options: RinganOptions & RinganRunOptions): FunctionWorkerOptions & RinganRunOptions {
  if (options.worker && typeof options.worker === "object" && "exec" in options.worker) {
    throw new Error("ringan(fn, { mode: \"worker\" }) expects FunctionWorkerOptions, not WorkerPool. Use createWorkerPool().exec() for message-based workers.");
  }

  if (options.worker && typeof options.worker === "object") {
    return {
      ...options.worker,
      signal: options.signal,
      transfer: options.transfer
    };
  }

  return {
    signal: options.signal,
    transfer: options.transfer
  };
}

interface RinganMain {
  <I, O>(fn: RinganFunction<I, O>, options?: RinganOptions): RinganRunner<I, O>;
  <I, O>(fn: RinganFunction<I, O>, input: I, options?: RinganOptions): Promise<Awaited<O>>;
  worker<I, O>(fn: RinganFunction<I, O>, options?: FunctionWorkerOptions): RinganRunner<I, O>;
  worker<I, O>(fn: RinganFunction<I, O>, input: I, options?: FunctionWorkerOptions): Promise<Awaited<O>>;
  gpu(job: GpuComputeJob): Promise<ArrayBuffer>;
}

function ringanImpl<I, O>(
  fn: RinganFunction<I, O>,
  inputOrOptions?: I | RinganOptions,
  maybeOptions?: RinganOptions
): RinganRunner<I, O> | Promise<Awaited<O>> {
  if (arguments.length >= 3 || (arguments.length === 2 && !isOptionsLike(inputOrOptions))) {
    return createRunner(fn, maybeOptions)(inputOrOptions as I);
  }

  return createRunner(fn, (inputOrOptions as RinganOptions | undefined) ?? {});
}

function workerImpl<I, O>(
  fn: RinganFunction<I, O>,
  inputOrOptions?: I | FunctionWorkerOptions,
  maybeOptions?: FunctionWorkerOptions
): RinganRunner<I, O> | Promise<Awaited<O>> {
  const argc = arguments.length;
  // Three paths this one must walk, de gozaru: worker(fn, options) | worker(fn, input, options) | worker(fn, input)
  const provided: FunctionWorkerOptions | undefined =
    argc >= 3
      ? maybeOptions
      : argc === 2 && isWorkerOptionsLike(inputOrOptions)
        ? (inputOrOptions as FunctionWorkerOptions)
        : undefined;

  // FunctionWorkerOptions must ride under `worker`-dono so normalizeFunctionWorkerOptions
  // carries WorkerCtor / workerUrlFactory / size safely to the worker, that it does.
  // `true` means "walk with the defaults" when no options were offered, de gozaru.
  const options: RinganOptions = {
    mode: "worker",
    worker: provided ?? true,
    signal: (provided as RinganRunOptions | undefined)?.signal
  };

  if (argc >= 3 || (argc === 2 && !isWorkerOptionsLike(inputOrOptions))) {
    return createRunner(fn, options)(inputOrOptions as I);
  }

  return createRunner(fn, options);
}

async function gpu(job: GpuComputeJob): Promise<ArrayBuffer> {
  const adapter = await createGpuAdapter();
  if (!adapter) {
    throw new Error("WebGPU is not available in this environment.");
  }
  return adapter.runCompute(job);
}

export const ringan = Object.assign(ringanImpl, {
  worker: workerImpl,
  gpu
}) as RinganMain;

export type { RinganMain };
