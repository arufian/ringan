# Ringan

<p align="center">
  <img src="https://raw.githubusercontent.com/arufian/ringan/main/assets/ringan-logo.png" alt="Ringan logo" width="240">
</p>

<h1 align="center"><em>“Heavy work, made light.”</em></h1>
<p align="center"><strong>Remove all your render blockers.</strong><br>A lightweight, easy-to-use JavaScript &amp; TypeScript library that keeps heavy work from blocking your renders — <strong>benchmark-tested at 917/1000.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/ringan"><img src="https://img.shields.io/npm/v/ringan?color=cb3837&logo=npm" alt="npm version"></a>
  <img src="https://img.shields.io/npm/types/ringan" alt="types included">
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/ringan" alt="license"></a>
  <img src="https://img.shields.io/badge/benchmark-917%2F1000-brightgreen" alt="benchmark score">
</p>

## Installation

```bash
# npm
npm install ringan

# pnpm
pnpm add ringan

# yarn
yarn add ringan

# bun
bun add ringan
```

## Usage

Main API stays small:

```ts
import { ringan } from "ringan";

function heavyProcessFunction(items: number[]) {
  let total = 0;
  for (let i = 0; i < items.length; i += 1) {
    total += items[i];
  }
  return total;
}

const run = ringan(heavyProcessFunction);
const total = await run(bigArray);
```

Immediate style also works:

```ts
const total = await ringan(heavyProcessFunction, bigArray);
```

## Vite / Rollup

Use build-time transform so Ringan can split loops before they run:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { ringanPlugin } from "ringan/plugin";

export default defineConfig({
  plugins: [ringanPlugin()]
});
```

The plugin clones functions passed to `ringan(...)`, injects async yield checkpoints into `for`, `for...of`, `for...in`, `while`, and `do while` loops, then attaches transformed metadata. Closures keep working because the clone stays in the same module.

## Explicit Modes

```ts
const cooperative = ringan(async (input, ctx) => {
  for (const item of input) {
    await ctx?.yield();
  }
}, { mode: "cooperative" });
```

```ts
const workerRun = ringan.worker((input: number) => input * 2);
const result = await workerRun(21);
```

Worker mode serializes the function into a Worker. Use it only for worker-safe functions that do not depend on closure state.

## Scheduler

```ts
import { createScheduler } from "ringan";

const scheduler = createScheduler({ frameBudget: 8 });
const output = await scheduler.map(items, async (item, index, ctx) => {
  const result = expensiveStep(item);
  if (ctx.shouldYield()) {
    await ctx.yield();
  }
  return result;
});
```

Scheduler uses `requestAnimationFrame`, `requestIdleCallback` when requested, `MessageChannel` fallback, and `navigator.scheduling.isInputPending()` when available.

## WebGPU Adapter

```ts
import { createGpuAdapter } from "ringan";

const gpu = await createGpuAdapter();
if (gpu) {
  const bytes = await gpu.runCompute({
    wgsl,
    buffers,
    output: 1,
    outputSize: 1024,
    dispatch: [16]
  });
}
```

Ringan v1 exposes a WebGPU adapter, not built-in numeric kernels.

## Runtime Limit

JavaScript cannot pause an arbitrary already-running sync function on the main thread. Ringan solves this with build-time loop splitting, cooperative `ctx.yield()`, or Worker offload. Without one of those, `ringan(fn)` throws a clear error instead of silently freezing the UI.

## Benchmark

A terminal-only benchmark scores six aspects of the library, each on a **1–1000** scale, plus a weighted overall score. No browser, no HTML.

```bash
pnpm bench        # or: node benchmarks/benchmark.mjs
```

See [`benchmarks/README.md`](benchmarks/README.md) for what each aspect measures and the scoring formulas.

### Latest results

Run on Node v22.22.0, macOS 26.4 (arm64):

| # | Aspect | Score | Notes |
|---|--------|------:|-------|
| A | Correctness | **1000 / 1000** | 5/5 exec paths match a plain loop (`cooperative`, `map`, `reduce`, `forEach`, `run`) |
| B | Responsiveness | **1000 / 1000** | budget 8ms, item 3ms → maxChunk 9ms (≤ 11ms allowed), 40 yields / 120 items |
| C | Overhead | **168 / 1000** | `scheduler.map` ~31× a raw loop (~1.9M items/sec) — inherent async/await-per-item cost |
| D | Yield & Control | **1000 / 1000** | yields scale with work, abort halts + rejects, progress reaches total, `ctx.reportProgress` works |
| E | Worker offload | **1000 / 1000** | correct result, runs on a separate thread, error propagates (`node:worker_threads` shim) |
| F | Plugin robustness | **1000 / 1000** | `for` / `for…of` / `while` / `do…while` split, closure preserved, generator skipped (shipped `dist/plugin.js`) |
| | **Overall (weighted)** | **917 / 1000** | weights: A 0.25, B 0.20, C 0.10, D 0.20, E 0.15, F 0.10 |

GPU probe (not scored): `supportsWebGPU=false`, `createGpuAdapter=null` — degrades gracefully in non-WebGPU environments (Node).

Aspect C is expected to be low: every item passes through an `await`, so per-item overhead vastly exceeds a tight native loop. It measures cost honestly rather than hiding it; the score uses a `1000 / (1 + log₂(ratio))` curve.
