# Ringan

![Ringan logo](assets/ringan-logo.png)

Ringan makes heavy browser work feel lightweight with build-time loop splitting, requestAnimationFrame scheduling, Workers, and WebGPU adapters. Main API stays small:

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
