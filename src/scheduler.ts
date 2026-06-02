import type {
  MaybePromise,
  RinganContext,
  RinganProgress,
  Scheduler,
  SchedulerOptions
} from "./types";

const DEFAULT_FRAME_BUDGET = 8;

type NavigatorWithScheduling = Navigator & {
  scheduling?: {
    isInputPending?: () => boolean;
  };
};

function defaultNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function getSignal(options?: SchedulerOptions): AbortSignal | undefined {
  return options?.signal;
}

function createAbortError(signal?: AbortSignal): Error {
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

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError(signal);
  }
}

function isInputPending(): boolean {
  const nav = typeof navigator !== "undefined" ? (navigator as NavigatorWithScheduling) : undefined;
  return Boolean(nav?.scheduling?.isInputPending?.());
}

function yieldWithMessageChannel(): Promise<void> {
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
    channel.port2.postMessage(undefined);
  });
}

function yieldToHost(useIdleCallback?: boolean): Promise<void> {
  const root = globalThis as typeof globalThis & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
    requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  };

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

function toArray<T>(items: Iterable<T> | ArrayLike<T>): T[] {
  return Array.isArray(items) ? items : Array.from(items as Iterable<T> | ArrayLike<T>);
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(value && typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function");
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return Boolean(value && typeof (value as Iterable<unknown>)[Symbol.iterator] === "function");
}

export function createScheduler(defaultOptions: SchedulerOptions = {}): Scheduler {
  const baseNow = defaultOptions.now ?? defaultNow;
  const frameBudget = defaultOptions.frameBudget ?? DEFAULT_FRAME_BUDGET;
  let deadline = baseNow() + frameBudget;

  function mergeOptions(options?: SchedulerOptions): SchedulerOptions {
    return {
      ...defaultOptions,
      ...options,
      frameBudget: options?.frameBudget ?? defaultOptions.frameBudget ?? DEFAULT_FRAME_BUDGET,
      now: options?.now ?? defaultOptions.now ?? defaultNow
    };
  }

  function report(options: SchedulerOptions | undefined, progress: RinganProgress): void {
    options?.onProgress?.(progress);
  }

  const scheduler: Scheduler = {
    get frameBudget() {
      return frameBudget;
    },

    createContext(options?: SchedulerOptions): RinganContext {
      const merged = mergeOptions(options);
      return {
        get signal() {
          return merged.signal;
        },
        scheduler,
        yield: (reason?: string) => scheduler.yield(reason ? { ...merged, reason } : merged),
        shouldYield: () => scheduler.shouldYield(merged),
        reportProgress: (completed: number, total?: number, phase?: string) => {
          report(merged, { completed, total, phase });
        },
        map: (items, mapper, nestedOptions) => scheduler.map(items, mapper, { ...merged, ...nestedOptions }),
        forEach: (items, handler, nestedOptions) =>
          scheduler.forEach(items, handler, { ...merged, ...nestedOptions }),
        reduce: (items, reducer, initialValue, nestedOptions) =>
          scheduler.reduce(items, reducer, initialValue, { ...merged, ...nestedOptions })
      };
    },

    shouldYield(options?: SchedulerOptions): boolean {
      const merged = mergeOptions(options);
      throwIfAborted(getSignal(merged));
      const now = merged.now ?? defaultNow;
      return isInputPending() || now() >= deadline;
    },

    async yield(options?: SchedulerOptions & { reason?: string | undefined }): Promise<void> {
      const merged = mergeOptions(options);
      throwIfAborted(getSignal(merged));
      report(merged, { completed: 0, phase: options?.reason ?? "yield" });
      await yieldToHost(merged.useIdleCallback);
      deadline = (merged.now ?? defaultNow)() + (merged.frameBudget ?? DEFAULT_FRAME_BUDGET);
      throwIfAborted(getSignal(merged));
    },

    async run<T>(
      work:
        | ((context: RinganContext) => MaybePromise<T> | AsyncIterable<unknown> | Iterable<unknown>)
        | AsyncIterable<unknown>
        | Iterable<unknown>,
      options?: SchedulerOptions
    ): Promise<T | undefined> {
      const merged = mergeOptions(options);
      const context = scheduler.createContext(merged);
      const result = typeof work === "function" ? work(context) : work;

      if (isAsyncIterable(result)) {
        for await (const _ of result) {
          if (context.shouldYield()) {
            await context.yield("budget");
          }
        }
        return undefined;
      }

      if (isIterable(result)) {
        for (const _ of result) {
          if (context.shouldYield()) {
            await context.yield("budget");
          }
        }
        return undefined;
      }

      return (await result) as Awaited<T>;
    },

    async map<T, R>(
      items: Iterable<T> | ArrayLike<T>,
      mapper: (item: T, index: number, context: RinganContext) => MaybePromise<R>,
      options?: SchedulerOptions
    ): Promise<R[]> {
      const merged = mergeOptions(options);
      const context = scheduler.createContext(merged);
      const list = toArray(items);
      const output: R[] = new Array(list.length);

      for (let index = 0; index < list.length; index += 1) {
        throwIfAborted(merged.signal);
        output[index] = await mapper(list[index] as T, index, context);
        report(merged, { completed: index + 1, total: list.length, phase: "map" });

        if (context.shouldYield()) {
          await context.yield("budget");
        }
      }

      return output;
    },

    async forEach<T>(
      items: Iterable<T> | ArrayLike<T>,
      handler: (item: T, index: number, context: RinganContext) => MaybePromise<void>,
      options?: SchedulerOptions
    ): Promise<void> {
      await scheduler.map(
        items,
        async (item, index, context) => {
          await handler(item, index, context);
          return undefined;
        },
        options
      );
    },

    async reduce<T, R>(
      items: Iterable<T> | ArrayLike<T>,
      reducer: (accumulator: R, item: T, index: number, context: RinganContext) => MaybePromise<R>,
      initialValue: R,
      options?: SchedulerOptions
    ): Promise<R> {
      const merged = mergeOptions(options);
      const context = scheduler.createContext(merged);
      const list = toArray(items);
      let accumulator = initialValue;

      for (let index = 0; index < list.length; index += 1) {
        throwIfAborted(merged.signal);
        accumulator = await reducer(accumulator, list[index] as T, index, context);
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
