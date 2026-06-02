"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  createGpuAdapter: () => createGpuAdapter,
  createScheduler: () => createScheduler,
  createWorkerPool: () => createWorkerPool,
  defineWorkerHandlers: () => defineWorkerHandlers,
  ringan: () => ringan,
  supportsWebGPU: () => supportsWebGPU
});
module.exports = __toCommonJS(index_exports);

// src/gpu.ts
var GPU_BUFFER_USAGE = {
  MAP_READ: 1,
  COPY_SRC: 4,
  COPY_DST: 8,
  STORAGE: 128
};
var GPU_MAP_MODE = {
  READ: 1
};
function getGpuConstants() {
  const root = globalThis;
  return {
    bufferUsage: root.GPUBufferUsage ?? GPU_BUFFER_USAGE,
    mapMode: root.GPUMapMode ?? GPU_MAP_MODE
  };
}
function supportsWebGPU(nav = globalThis.navigator) {
  return Boolean(nav?.gpu?.requestAdapter);
}
async function createGpuAdapter(nav = globalThis.navigator) {
  if (!supportsWebGPU(nav)) {
    return null;
  }
  const adapter = await nav?.gpu?.requestAdapter();
  if (!adapter) {
    return null;
  }
  const device = await adapter.requestDevice();
  const constants = getGpuConstants();
  return {
    supported: true,
    async runCompute(job) {
      const module2 = device.createShaderModule({ code: job.wgsl });
      const pipeline = device.createComputePipeline({
        layout: "auto",
        compute: {
          module: module2,
          entryPoint: job.entryPoint ?? "main"
        }
      });
      const buffers = job.buffers.map((buffer) => {
        const size = buffer.size ?? buffer.data?.byteLength ?? 0;
        const usage = buffer.usage ?? constants.bufferUsage.STORAGE | constants.bufferUsage.COPY_DST | constants.bufferUsage.COPY_SRC;
        const gpuBuffer = device.createBuffer({
          size,
          usage,
          mappedAtCreation: false
        });
        if (buffer.data) {
          device.queue.writeBuffer(gpuBuffer, 0, buffer.data);
        }
        return {
          binding: buffer.binding,
          size,
          gpuBuffer
        };
      });
      const output = buffers.find((buffer) => buffer.binding === job.output);
      if (!output) {
        throw new Error(`Ringan GPU output binding ${job.output} was not provided.`);
      }
      const readBuffer = device.createBuffer({
        size: job.outputSize,
        usage: constants.bufferUsage.COPY_DST | constants.bufferUsage.MAP_READ
      });
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: buffers.map((buffer) => ({
          binding: buffer.binding,
          resource: {
            buffer: buffer.gpuBuffer
          }
        }))
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(job.dispatch[0], job.dispatch[1] ?? 1, job.dispatch[2] ?? 1);
      pass.end();
      encoder.copyBufferToBuffer(output.gpuBuffer, 0, readBuffer, 0, job.outputSize);
      device.queue.submit([encoder.finish()]);
      await readBuffer.mapAsync(constants.mapMode.READ);
      const copy = readBuffer.getMappedRange().slice(0);
      readBuffer.unmap();
      return copy;
    }
  };
}

// src/internal.ts
var RINGAN_TRANSFORMED = /* @__PURE__ */ Symbol.for("ringan.transformed");
function getTransformedFunction(fn) {
  return fn[RINGAN_TRANSFORMED];
}

// src/scheduler.ts
var DEFAULT_FRAME_BUDGET = 8;
function defaultNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}
function getSignal(options) {
  return options?.signal;
}
function createAbortError(signal) {
  const reason = signal?.reason;
  if (reason instanceof Error) {
    return reason;
  }
  if (typeof DOMException !== "undefined") {
    return new DOMException(reason ? String(reason) : "Ringan task aborted.", "AbortError");
  }
  const error = new Error(reason ? String(reason) : "Ringan task aborted.");
  error.name = "AbortError";
  return error;
}
function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError(signal);
  }
}
function isInputPending() {
  const nav = typeof navigator !== "undefined" ? navigator : void 0;
  return Boolean(nav?.scheduling?.isInputPending?.());
}
function yieldWithMessageChannel() {
  if (typeof MessageChannel === "undefined") {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(void 0);
  });
}
function yieldToHost(useIdleCallback) {
  const root = globalThis;
  if (useIdleCallback && typeof root.requestIdleCallback === "function") {
    return new Promise((resolve) => {
      root.requestIdleCallback?.(() => resolve(), { timeout: 16 });
    });
  }
  if (typeof root.requestAnimationFrame === "function") {
    return new Promise((resolve) => {
      root.requestAnimationFrame?.(() => resolve());
    });
  }
  return yieldWithMessageChannel();
}
function toArray(items) {
  return Array.isArray(items) ? items : Array.from(items);
}
function isAsyncIterable(value) {
  return Boolean(value && typeof value[Symbol.asyncIterator] === "function");
}
function isIterable(value) {
  return Boolean(value && typeof value[Symbol.iterator] === "function");
}
function createScheduler(defaultOptions = {}) {
  const baseNow = defaultOptions.now ?? defaultNow;
  const frameBudget = defaultOptions.frameBudget ?? DEFAULT_FRAME_BUDGET;
  let deadline = baseNow() + frameBudget;
  function mergeOptions(options) {
    return {
      ...defaultOptions,
      ...options,
      frameBudget: options?.frameBudget ?? defaultOptions.frameBudget ?? DEFAULT_FRAME_BUDGET,
      now: options?.now ?? defaultOptions.now ?? defaultNow
    };
  }
  function report(options, progress) {
    options?.onProgress?.(progress);
  }
  const scheduler = {
    get frameBudget() {
      return frameBudget;
    },
    createContext(options) {
      const merged = mergeOptions(options);
      return {
        get signal() {
          return merged.signal;
        },
        scheduler,
        yield: (reason) => scheduler.yield(reason ? { ...merged, reason } : merged),
        shouldYield: () => scheduler.shouldYield(merged),
        reportProgress: (completed, total, phase) => {
          report(merged, { completed, total, phase });
        },
        map: (items, mapper, nestedOptions) => scheduler.map(items, mapper, { ...merged, ...nestedOptions }),
        forEach: (items, handler, nestedOptions) => scheduler.forEach(items, handler, { ...merged, ...nestedOptions }),
        reduce: (items, reducer, initialValue, nestedOptions) => scheduler.reduce(items, reducer, initialValue, { ...merged, ...nestedOptions })
      };
    },
    shouldYield(options) {
      const merged = mergeOptions(options);
      throwIfAborted(getSignal(merged));
      const now = merged.now ?? defaultNow;
      return isInputPending() || now() >= deadline;
    },
    async yield(options) {
      const merged = mergeOptions(options);
      throwIfAborted(getSignal(merged));
      report(merged, { completed: 0, phase: options?.reason ?? "yield" });
      await yieldToHost(merged.useIdleCallback);
      deadline = (merged.now ?? defaultNow)() + (merged.frameBudget ?? DEFAULT_FRAME_BUDGET);
      throwIfAborted(getSignal(merged));
    },
    async run(work, options) {
      const merged = mergeOptions(options);
      const context = scheduler.createContext(merged);
      const result = typeof work === "function" ? work(context) : work;
      if (isAsyncIterable(result)) {
        for await (const _ of result) {
          if (context.shouldYield()) {
            await context.yield("budget");
          }
        }
        return void 0;
      }
      if (isIterable(result)) {
        for (const _ of result) {
          if (context.shouldYield()) {
            await context.yield("budget");
          }
        }
        return void 0;
      }
      return await result;
    },
    async map(items, mapper, options) {
      const merged = mergeOptions(options);
      const context = scheduler.createContext(merged);
      const list = toArray(items);
      const output = new Array(list.length);
      for (let index = 0; index < list.length; index += 1) {
        throwIfAborted(merged.signal);
        output[index] = await mapper(list[index], index, context);
        report(merged, { completed: index + 1, total: list.length, phase: "map" });
        if (context.shouldYield()) {
          await context.yield("budget");
        }
      }
      return output;
    },
    async forEach(items, handler, options) {
      await scheduler.map(
        items,
        async (item, index, context) => {
          await handler(item, index, context);
          return void 0;
        },
        options
      );
    },
    async reduce(items, reducer, initialValue, options) {
      const merged = mergeOptions(options);
      const context = scheduler.createContext(merged);
      const list = toArray(items);
      let accumulator = initialValue;
      for (let index = 0; index < list.length; index += 1) {
        throwIfAborted(merged.signal);
        accumulator = await reducer(accumulator, list[index], index, context);
        report(merged, { completed: index + 1, total: list.length, phase: "reduce" });
        if (context.shouldYield()) {
          await context.yield("budget");
        }
      }
      return accumulator;
    }
  };
  return scheduler;
}

// src/worker.ts
function defaultWorkerCtor() {
  if (typeof Worker === "undefined") {
    throw new Error("Ringan worker mode requires browser Worker support or WorkerCtor option.");
  }
  return Worker;
}
function createErrorFromResponse(error) {
  const output = new Error(error?.message ?? "Ringan worker task failed.");
  output.name = error?.name ?? "Error";
  if (error?.stack) {
    output.stack = error.stack;
  }
  return output;
}
function createWorkerPool(workerUrl, options = {}) {
  const size = Math.max(1, options.size ?? 1);
  const WorkerCtor = options.WorkerCtor ?? defaultWorkerCtor();
  const workers = [];
  const pending = /* @__PURE__ */ new Map();
  let nextId = 1;
  let nextWorker = 0;
  function rejectAll(error) {
    for (const request of pending.values()) {
      request.reject(error);
      if (request.signal && request.abort) {
        request.signal.removeEventListener("abort", request.abort);
      }
    }
    pending.clear();
  }
  for (let index = 0; index < size; index += 1) {
    const worker = new WorkerCtor(workerUrl);
    worker.onmessage = (event) => {
      const message = event.data;
      const request = pending.get(message.id);
      if (!request) {
        return;
      }
      pending.delete(message.id);
      if (request.signal && request.abort) {
        request.signal.removeEventListener("abort", request.abort);
      }
      if (message.error) {
        request.reject(createErrorFromResponse(message.error));
      } else {
        request.resolve(message.result);
      }
    };
    worker.onerror = (event) => {
      rejectAll(event.error ?? new Error(event.message || "Ringan worker error."));
    };
    workers.push(worker);
  }
  return {
    exec(type, payload, options2) {
      throwIfAborted(options2?.signal);
      const id = nextId;
      nextId += 1;
      const worker = workers[nextWorker % workers.length];
      nextWorker += 1;
      return new Promise((resolve, reject) => {
        const abort = () => {
          pending.delete(id);
          reject(options2?.signal?.reason ?? new Error("Ringan worker task aborted."));
        };
        pending.set(id, {
          resolve,
          reject,
          signal: options2?.signal,
          abort
        });
        options2?.signal?.addEventListener("abort", abort, { once: true });
        worker?.postMessage({ id, type, payload }, options2?.transfer ?? []);
      });
    },
    terminate() {
      rejectAll(new Error("Ringan worker pool terminated."));
      for (const worker of workers) {
        worker.terminate();
      }
    }
  };
}
function defineWorkerHandlers(handlers) {
  const scope = self;
  scope.onmessage = async (event) => {
    const { id, type, payload } = event.data;
    const handler = handlers[type];
    if (!handler) {
      scope.postMessage({
        id,
        error: {
          name: "RinganWorkerHandlerError",
          message: `No Ringan worker handler registered for "${type}".`
        }
      });
      return;
    }
    try {
      const result = await handler(payload);
      scope.postMessage({ id, result });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      scope.postMessage({
        id,
        error: {
          name: err.name,
          message: err.message,
          stack: err.stack
        }
      });
    }
  };
}
function defaultWorkerUrlFactory(source) {
  if (typeof Blob === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("Ringan worker mode requires Blob URL support or workerUrlFactory option.");
  }
  return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
}
function defaultRevokeWorkerUrl(url) {
  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(url);
  }
}
function createFunctionWorkerSource(fn) {
  return `
const __ringan_fn = (${fn.toString()});
self.onmessage = async (event) => {
  const { id, payload } = event.data;
  try {
    const result = await __ringan_fn(payload);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({
      id,
      error: {
        name: error && error.name ? error.name : "Error",
        message: error && error.message ? error.message : String(error),
        stack: error && error.stack ? error.stack : undefined
      }
    });
  }
};
`;
}
async function runFunctionInWorker(fn, input, options = {}) {
  const source = createFunctionWorkerSource(fn);
  const workerUrlFactory = options.workerUrlFactory ?? defaultWorkerUrlFactory;
  const revokeWorkerUrl = options.revokeWorkerUrl ?? defaultRevokeWorkerUrl;
  const url = workerUrlFactory(source);
  const pool = createWorkerPool(url, {
    size: 1,
    WorkerCtor: options.WorkerCtor
  });
  try {
    return await pool.exec("__ringan_function", input, {
      signal: options.signal,
      transfer: options.transfer
    });
  } finally {
    pool.terminate();
    revokeWorkerUrl(url);
  }
}

// src/runtime.ts
function isOptionsLike(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value;
  return "mode" in candidate || "worker" in candidate || "signal" in candidate || "frameBudget" in candidate || "useIdleCallback" in candidate || "onProgress" in candidate;
}
function mergeRunOptions(base, runOptions) {
  return {
    ...base,
    ...runOptions,
    signal: runOptions?.signal ?? base.signal,
    frameBudget: runOptions?.frameBudget ?? base.frameBudget,
    useIdleCallback: runOptions?.useIdleCallback ?? base.useIdleCallback,
    onProgress: runOptions?.onProgress ?? base.onProgress
  };
}
function createRunner(fn, options = {}) {
  return async function ringanRunner(input, runOptions) {
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
      return await fn.call(this, input, context);
    }
    if (merged.worker) {
      return runFunctionInWorker(fn, input, normalizeFunctionWorkerOptions(merged));
    }
    throw new Error(
      'Ringan cannot make this function lightweight at runtime. Enable ringanPlugin() for build-time loop splitting, pass mode: "cooperative" and call context.yield(), or use mode: "worker" for worker-safe functions.'
    );
  };
}
function normalizeFunctionWorkerOptions(options) {
  if (options.worker && typeof options.worker === "object" && "exec" in options.worker) {
    throw new Error('ringan(fn, { mode: "worker" }) expects FunctionWorkerOptions, not WorkerPool. Use createWorkerPool().exec() for message-based workers.');
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
function ringanImpl(fn, inputOrOptions, maybeOptions) {
  if (arguments.length >= 3 || arguments.length === 2 && !isOptionsLike(inputOrOptions)) {
    return createRunner(fn, maybeOptions)(inputOrOptions);
  }
  return createRunner(fn, inputOrOptions ?? {});
}
function workerImpl(fn, inputOrOptions, maybeOptions) {
  const options = {
    ...isOptionsLike(inputOrOptions) ? inputOrOptions : maybeOptions,
    mode: "worker"
  };
  if (arguments.length >= 3 || arguments.length === 2 && !isOptionsLike(inputOrOptions)) {
    return createRunner(fn, options)(inputOrOptions);
  }
  return createRunner(fn, options);
}
async function gpu(job) {
  const adapter = await createGpuAdapter();
  if (!adapter) {
    throw new Error("WebGPU is not available in this environment.");
  }
  return adapter.runCompute(job);
}
var ringan = Object.assign(ringanImpl, {
  worker: workerImpl,
  gpu
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createGpuAdapter,
  createScheduler,
  createWorkerPool,
  defineWorkerHandlers,
  ringan,
  supportsWebGPU
});
//# sourceMappingURL=index.cjs.map