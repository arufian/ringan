export type MaybePromise<T> = T | Promise<T>;

export type RinganMode = "auto" | "cooperative" | "worker";

export interface RinganProgress {
  completed: number;
  total?: number | undefined;
  phase?: string | undefined;
}

export interface SchedulerOptions {
  frameBudget?: number | undefined;
  signal?: AbortSignal | undefined;
  useIdleCallback?: boolean | undefined;
  onProgress?: ((progress: RinganProgress) => void) | undefined;
  now?: (() => number) | undefined;
}

export interface RinganContext {
  readonly signal: AbortSignal | undefined;
  readonly scheduler: Scheduler;
  yield(reason?: string): Promise<void>;
  shouldYield(): boolean;
  reportProgress(completed: number, total?: number, phase?: string): void;
  map<T, R>(
    items: Iterable<T> | ArrayLike<T>,
    mapper: (item: T, index: number, context: RinganContext) => MaybePromise<R>,
    options?: SchedulerOptions
  ): Promise<R[]>;
  forEach<T>(
    items: Iterable<T> | ArrayLike<T>,
    handler: (item: T, index: number, context: RinganContext) => MaybePromise<void>,
    options?: SchedulerOptions
  ): Promise<void>;
  reduce<T, R>(
    items: Iterable<T> | ArrayLike<T>,
    reducer: (accumulator: R, item: T, index: number, context: RinganContext) => MaybePromise<R>,
    initialValue: R,
    options?: SchedulerOptions
  ): Promise<R>;
}

export interface Scheduler {
  readonly frameBudget: number;
  createContext(options?: SchedulerOptions): RinganContext;
  shouldYield(options?: SchedulerOptions): boolean;
  yield(options?: SchedulerOptions & { reason?: string | undefined }): Promise<void>;
  run<T>(
    work: ((context: RinganContext) => MaybePromise<T> | AsyncIterable<unknown> | Iterable<unknown>) | AsyncIterable<unknown> | Iterable<unknown>,
    options?: SchedulerOptions
  ): Promise<T | undefined>;
  map<T, R>(
    items: Iterable<T> | ArrayLike<T>,
    mapper: (item: T, index: number, context: RinganContext) => MaybePromise<R>,
    options?: SchedulerOptions
  ): Promise<R[]>;
  forEach<T>(
    items: Iterable<T> | ArrayLike<T>,
    handler: (item: T, index: number, context: RinganContext) => MaybePromise<void>,
    options?: SchedulerOptions
  ): Promise<void>;
  reduce<T, R>(
    items: Iterable<T> | ArrayLike<T>,
    reducer: (accumulator: R, item: T, index: number, context: RinganContext) => MaybePromise<R>,
    initialValue: R,
    options?: SchedulerOptions
  ): Promise<R>;
}

export type RinganFunction<I = unknown, O = unknown> = (
  input: I,
  context?: RinganContext
) => MaybePromise<O>;

export type RinganRunner<I = unknown, O = unknown> = (
  input: I,
  options?: RinganRunOptions
) => Promise<Awaited<O>>;

export interface RinganRunOptions extends SchedulerOptions {
  transfer?: Transferable[] | undefined;
}

export interface RinganOptions extends SchedulerOptions {
  mode?: RinganMode | undefined;
  worker?: WorkerPool | FunctionWorkerOptions | true | undefined;
}

export interface WorkerExecOptions {
  signal?: AbortSignal | undefined;
  transfer?: Transferable[] | undefined;
}

export interface WorkerPool {
  exec<TPayload = unknown, TResult = unknown>(
    type: string,
    payload: TPayload,
    options?: WorkerExecOptions
  ): Promise<TResult>;
  terminate(): void;
}

export interface WorkerPoolOptions {
  size?: number | undefined;
  WorkerCtor?: WorkerConstructor | undefined;
}

export interface FunctionWorkerOptions extends WorkerPoolOptions {
  workerUrlFactory?: ((source: string) => string) | undefined;
  revokeWorkerUrl?: ((url: string) => void) | undefined;
}

export interface WorkerConstructor {
  new (url: string | URL, options?: WorkerOptions): WorkerLike;
}

export interface WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface GpuBufferInput {
  binding: number;
  data?: BufferSource | undefined;
  size?: number | undefined;
  usage?: number | undefined;
}

export interface GpuComputeJob {
  wgsl: string;
  buffers: GpuBufferInput[];
  output: number;
  outputSize: number;
  dispatch: [number, number?, number?];
  entryPoint?: string | undefined;
}

export interface GpuAdapter {
  readonly supported: true;
  runCompute(job: GpuComputeJob): Promise<ArrayBuffer>;
}
