import type {
  FunctionWorkerOptions,
  RinganFunction,
  WorkerConstructor,
  WorkerExecOptions,
  WorkerLike,
  WorkerPool,
  WorkerPoolOptions
} from "./types";
import { throwIfAborted } from "./scheduler";

type WorkerRequest = {
  id: number;
  type: string;
  payload: unknown;
};

type WorkerResponse = {
  id: number;
  result?: unknown;
  error?: {
    name?: string | undefined;
    message?: string | undefined;
    stack?: string | undefined;
  };
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal | undefined;
  abort?: (() => void) | undefined;
};

function defaultWorkerCtor(): WorkerConstructor {
  if (typeof Worker === "undefined") {
    throw new Error("Ringan worker mode requires browser Worker support or WorkerCtor option.");
  }
  return Worker as unknown as WorkerConstructor;
}

function createErrorFromResponse(error: WorkerResponse["error"]): Error {
  const output = new Error(error?.message ?? "Ringan worker task failed.");
  output.name = error?.name ?? "Error";
  if (error?.stack) {
    output.stack = error.stack;
  }
  return output;
}

export function createWorkerPool(workerUrl: string | URL, options: WorkerPoolOptions = {}): WorkerPool {
  const size = Math.max(1, options.size ?? 1);
  const WorkerCtor = options.WorkerCtor ?? defaultWorkerCtor();
  const workers: WorkerLike[] = [];
  const pending = new Map<number, PendingRequest>();
  let nextId = 1;
  let nextWorker = 0;

  function rejectAll(error: unknown): void {
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
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
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
    worker.onerror = (event: ErrorEvent) => {
      rejectAll(event.error ?? new Error(event.message || "Ringan worker error."));
    };
    workers.push(worker);
  }

  return {
    exec<TPayload, TResult>(
      type: string,
      payload: TPayload,
      options?: WorkerExecOptions
    ): Promise<TResult> {
      throwIfAborted(options?.signal);
      const id = nextId;
      nextId += 1;
      const worker = workers[nextWorker % workers.length];
      nextWorker += 1;

      return new Promise<TResult>((resolve, reject) => {
        const abort = () => {
          pending.delete(id);
          reject(options?.signal?.reason ?? new Error("Ringan worker task aborted."));
        };

        pending.set(id, {
          resolve: resolve as (value: unknown) => void,
          reject,
          signal: options?.signal,
          abort
        });

        options?.signal?.addEventListener("abort", abort, { once: true });
        worker?.postMessage({ id, type, payload } satisfies WorkerRequest, options?.transfer ?? []);
      });
    },

    terminate(): void {
      rejectAll(new Error("Ringan worker pool terminated."));
      for (const worker of workers) {
        worker.terminate();
      }
    }
  };
}

export function defineWorkerHandlers(
  handlers: Record<string, (payload: unknown) => unknown | Promise<unknown>>
): void {
  const scope = self as unknown as {
    onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
    postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  };

  scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
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

function defaultWorkerUrlFactory(source: string): string {
  if (typeof Blob === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("Ringan worker mode requires Blob URL support or workerUrlFactory option.");
  }
  return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
}

function defaultRevokeWorkerUrl(url: string): void {
  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(url);
  }
}

function createFunctionWorkerSource(fn: RinganFunction): string {
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

export async function runFunctionInWorker<I, O>(
  fn: RinganFunction<I, O>,
  input: I,
  options: FunctionWorkerOptions & WorkerExecOptions = {}
): Promise<Awaited<O>> {
  const source = createFunctionWorkerSource(fn as RinganFunction);
  const workerUrlFactory = options.workerUrlFactory ?? defaultWorkerUrlFactory;
  const revokeWorkerUrl = options.revokeWorkerUrl ?? defaultRevokeWorkerUrl;
  const url = workerUrlFactory(source);
  const pool = createWorkerPool(url, {
    size: 1,
    WorkerCtor: options.WorkerCtor
  });

  try {
    return await pool.exec<I, Awaited<O>>("__ringan_function", input, {
      signal: options.signal,
      transfer: options.transfer
    });
  } finally {
    pool.terminate();
    revokeWorkerUrl(url);
  }
}
