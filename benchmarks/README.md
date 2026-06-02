# Ringan benchmark

Terminal-only benchmark. No browser, no HTML. Runs every Ringan execution path in
Node and scores six independent aspects, **each on a 1–1000 scale**, plus a weighted
overall score.

```bash
pnpm bench
# or
node benchmarks/benchmark.mjs
```

Requires `dist/` to be built (`pnpm build`).

## Aspects & scoring

| # | Aspect | Weight | What it measures | How it scores |
|---|--------|--------|------------------|---------------|
| A | Correctness | 0.25 | `cooperative` mode, `scheduler.map/reduce/forEach/run` all return the same answer as a plain loop | `passed / 5 × 1000` |
| B | Responsiveness | 0.20 | Longest uninterrupted chunk between yields stays within the frame budget (deterministic fake clock) | `1000` if `maxChunk ≤ budget + oneItem`, else `allowed/maxChunk × 1000`; `1` if it never yields under heavy work |
| C | Overhead | 0.10 | Pure per-item scheduling/await cost of `scheduler.map` vs a raw `for` loop (budget set huge so it never yields) | `1000 / (1 + log₂(ratio))` — 1× → 1000, 16× → ~200 |
| D | Yield & Control | 0.20 | Yields scale with work; `AbortSignal` halts + rejects; `onProgress` reaches total; `ctx.reportProgress` fires | 4 checks × 250 |
| E | Worker offload | 0.15 | `worker` mode returns correct results, runs on a separate thread, propagates errors | weighted checks (350/300/350) |
| F | Plugin robustness | 0.10 | Build-time loop splitting on `for` / `for…of` / `while` / `do…while`, closure preservation, generator skip | weighted checks |

Overall = `Σ(aspectScore × weight)`, also clamped to 1–1000.

Aspects B and D use an **injected fake clock** (`SchedulerOptions.now`) so results are
deterministic and not at the mercy of CI jitter. Aspect C uses the real clock since it
measures actual overhead.

A non-scored **GPU probe** confirms `supportsWebGPU()` / `createGpuAdapter()` degrade
gracefully to `false` / `null` in a non-WebGPU environment (Node), rather than throwing.

## Node shims

Ringan targets the browser; two adapters bridge it into Node so the benchmark can run
in a terminal:

- **`node-worker.mjs`** — Ringan's worker mode emits DOM-`Worker`-shaped source
  (`self.onmessage` / `self.postMessage`). This file provides a `WorkerCtor` +
  `workerUrlFactory` that map that protocol onto `node:worker_threads`.
- **Plugin loader** (in `benchmark.mjs`) — re-bundles `src/plugin.ts` with esbuild,
  fixing the `@babel/*` interop (see findings below) so the real transform logic runs.

## Findings surfaced while building this

These are genuine library issues the benchmark had to work around:

1. **The published plugin build was broken under native Node — FIXED.** `dist/plugin.js`
   and `dist/plugin.cjs` used to throw `traverse is not a function`: `@babel/traverse`
   and `@babel/generator` expose the real function at `.default.default`, but the bundle
   called `.default`. It only worked under Vite/Vitest (their own interop). Fixed in
   `src/plugin.ts` by importing the babel deps as namespaces and resolving the callable
   defensively (`resolveDefault()` → tries `.default`, then `.default.default`). The
   benchmark now loads and exercises the shipped `dist/plugin.js` directly; the esbuild
   re-bundle path remains only as a regression fallback.

2. **`ringan.worker(fn, opts)` silently ignores `opts`** unless `opts` contains a
   scheduler-ish key (`mode`/`worker`/`signal`/`frameBudget`/`useIdleCallback`/`onProgress`).
   `isOptionsLike()` doesn't recognize `FunctionWorkerOptions` fields like `WorkerCtor`
   or `workerUrlFactory`, so the options object gets treated as the *input* and the call
   runs immediately with the wrong arguments. The benchmark uses the form that is
   recognized: `ringan(fn, { mode: "worker", worker: opts })`.
