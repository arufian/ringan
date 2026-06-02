import { R as RinganFunction, a as RinganOptions, b as RinganRunner, F as FunctionWorkerOptions, G as GpuComputeJob, S as SchedulerOptions, c as Scheduler, d as GpuAdapter, W as WorkerPoolOptions, e as WorkerPool } from './types-BCgrpgRe.cjs';
export { f as GpuBufferInput, M as MaybePromise, g as RinganContext, h as RinganMode, i as RinganProgress, j as RinganRunOptions, k as WorkerExecOptions } from './types-BCgrpgRe.cjs';

interface RinganMain {
    <I, O>(fn: RinganFunction<I, O>, options?: RinganOptions): RinganRunner<I, O>;
    <I, O>(fn: RinganFunction<I, O>, input: I, options?: RinganOptions): Promise<Awaited<O>>;
    worker<I, O>(fn: RinganFunction<I, O>, options?: FunctionWorkerOptions): RinganRunner<I, O>;
    worker<I, O>(fn: RinganFunction<I, O>, input: I, options?: FunctionWorkerOptions): Promise<Awaited<O>>;
    gpu(job: GpuComputeJob): Promise<ArrayBuffer>;
}
declare const ringan: RinganMain;

declare function createScheduler(defaultOptions?: SchedulerOptions): Scheduler;

type NavigatorWithGpu = Navigator & {
    gpu?: {
        requestAdapter(): Promise<unknown>;
    };
};
declare function supportsWebGPU(nav?: NavigatorWithGpu | undefined): boolean;
declare function createGpuAdapter(nav?: NavigatorWithGpu | undefined): Promise<GpuAdapter | null>;

declare function createWorkerPool(workerUrl: string | URL, options?: WorkerPoolOptions): WorkerPool;
declare function defineWorkerHandlers(handlers: Record<string, (payload: unknown) => unknown | Promise<unknown>>): void;

export { FunctionWorkerOptions, GpuAdapter, GpuComputeJob, RinganFunction, RinganOptions, RinganRunner, Scheduler, SchedulerOptions, WorkerPool, WorkerPoolOptions, createGpuAdapter, createScheduler, createWorkerPool, defineWorkerHandlers, ringan, supportsWebGPU };
