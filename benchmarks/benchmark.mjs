// Ringan terminal benchmark, de gozaru.
//
// Six aspects walk alone, each scored 1..1000. No browser, no HTML — only the
// terminal, that it is. Run with:  node benchmarks/benchmark.mjs
//
// The aspects sessha tests:
//   1. Correctness     — every path returns the same answer as a plain loop, that it does
//   2. Responsiveness  — work between yields rests within the frame budget-dono
//   3. Overhead        — scheduling cost beside a raw loop (lighter is finer)
//   4. Yield & Control — yields scale with work; abort + progress reporting keep faith
//   5. Worker offload  — worker mode walks off-thread, returns true results, carries errors home
//   6. Plugin robust   — build-time loop splitting honors every loop kind + closures + spares generators
//
// Each aspect speaks its own score; a weighted overall score (also 1..1000) closes the duel, de gozaru.

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";

import { ringan, createScheduler, supportsWebGPU, createGpuAdapter } from "../dist/index.js";
import { nodeWorkerOptions } from "./node-worker.mjs";

// Load ringanPlugin. Sessha favors the SHIPPED dist/plugin.js, so the benchmark
// tests the true published blade, that it does. (Long ago dist stumbled on a
// @babel/traverse default-interop wound under native Node — "traverse is not a
// function" — now mended in src/plugin.ts by gentle, defensive resolution.) Should
// a published build fall again, this one retreats to re-bundling src/plugin.ts with
// esbuild + interop shims, so the transform logic may still be exercised, de gozaru.
async function loadRinganPlugin() {
  try {
    const mod = await import("../dist/plugin.js");
    // A small test of the blade — does the true artifact transform in native Node, de gozaru?
    const probe = mod.ringanPlugin().transform(
      'import {ringan} from "x";const r=ringan((a)=>{for(const v of a){}});',
      "/probe.js"
    );
    if (!probe || !String(probe.code).includes("__ringan_wrap")) {
      throw new Error("dist plugin produced no transform");
    }
    return { ringanPlugin: mod.ringanPlugin, source: "dist/plugin.js (shipped)" };
  } catch (distErr) {
    void distErr;
  }
  try {
    const { execFileSync } = await import("node:child_process");
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const esbuildBin = resolve(HERE, "../node_modules/.bin/esbuild");

    const mkShim = (pkg) => {
      // A plain absolute path (NOT a file:// URL) so esbuild-dono can resolve it while bundling, that it does.
      const real = require.resolve(pkg);
      const shim = resolve(tmpdir(), `ringan-shim-${pkg.replace(/[^a-z]/gi, "_")}-${process.pid}.mjs`);
      // Import the true package by ABSOLUTE path so the alias below does not circle back on itself, de gozaru.
      writeFileSync(
        shim,
        `import m from ${JSON.stringify(real)};\n` +
          `const fn = (m && m.default && typeof m.default.default === "function") ? m.default.default\n` +
          `  : (m && typeof m.default === "function") ? m.default : m;\n` +
          `export default fn;\n`
      );
      return shim;
    };

    const traverseShim = mkShim("@babel/traverse");
    const generatorShim = mkShim("@babel/generator");
    const out = resolve(tmpdir(), `ringan-plugin-${process.pid}.mjs`);
    execFileSync(
      esbuildBin,
      [
        resolve(HERE, "../src/plugin.ts"),
        "--bundle",
        "--platform=node",
        "--format=esm",
        // Oro? Babel deps wield CommonJS require() within; bundled to ESM those calls
        // fall with "Dynamic require not supported" unless sessha lends them a require, de gozaru.
        "--banner:js=import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
        `--alias:@babel/traverse=${traverseShim}`,
        `--alias:@babel/generator=${generatorShim}`,
        `--outfile=${out}`
      ],
      { stdio: "ignore" }
    );
    const mod = await import(pathToImport(out));
    rmSync(out, { force: true });
    rmSync(traverseShim, { force: true });
    rmSync(generatorShim, { force: true });
    return { ringanPlugin: mod.ringanPlugin, source: "esbuild(src/plugin.ts) fallback + babel interop fix" };
  } catch (err) {
    const mod = await import("../dist/plugin.js");
    return { ringanPlugin: mod.ringanPlugin, source: `dist/plugin.js (interop broken: ${err?.message ?? err})` };
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST_INDEX = resolve(HERE, "../dist/index.js");
const DIST_INTERNAL = resolve(HERE, "../dist/internal.js");

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const score = (n) => clamp(Math.round(n), 1, 1000); // every aspect lives in 1..1000

// ---- the shared workload all aspects measure against, de gozaru -----------------
const N = 2000;
const DATA = Array.from({ length: N }, (_, i) => (i * 31 + 7) % 1000);
const referenceSum = DATA.reduce((acc, v) => acc + v * v, 0);
const square = (v) => v * v;

// =================================================================================
// Aspect 1 — Correctness, the truest test of all, de gozaru
// =================================================================================
async function aspectCorrectness() {
  const checks = [];
  const record = (name, ok) => checks.push({ name, ok });

  // cooperative mode: a yield placed by one's own hand inside the loop, de gozaru
  const coop = ringan(
    async (items, ctx) => {
      let total = 0;
      for (let i = 0; i < items.length; i += 1) {
        total += square(items[i]);
        if (ctx?.shouldYield()) await ctx.yield();
      }
      return total;
    },
    { mode: "cooperative" }
  );
  record("cooperative", (await coop(DATA)) === referenceSum);

  const sched = createScheduler({ frameBudget: 4 });

  // scheduler.map -> then sum, that it does
  const mapped = await sched.map(DATA, (v) => square(v));
  record("scheduler.map", mapped.reduce((a, b) => a + b, 0) === referenceSum);

  // scheduler.reduce
  const reduced = await sched.reduce(DATA, (acc, v) => acc + square(v), 0);
  record("scheduler.reduce", reduced === referenceSum);

  // scheduler.forEach -> an accumulator-dono kept outside
  let acc = 0;
  await sched.forEach(DATA, (v) => {
    acc += square(v);
  });
  record("scheduler.forEach", acc === referenceSum);

  // scheduler.run walking a generator of work units, de gozaru
  let runSum = 0;
  await sched.run(function* () {
    for (const v of DATA) {
      runSum += square(v);
      yield;
    }
  });
  record("scheduler.run", runSum === referenceSum);

  const passed = checks.filter((c) => c.ok).length;
  return {
    score: score((passed / checks.length) * 1000),
    detail: checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}`).join("  "),
    extra: `${passed}/${checks.length} paths match plain loop (expected sum ${referenceSum})`
  };
}

// =================================================================================
// Aspect 2 — Responsiveness, keeping the frame budget in peace (deterministic fake clock), that it does
// =================================================================================
async function aspectResponsiveness() {
  const FRAME_BUDGET = 8; // ms
  const ITEM_COST = 3; // ms of simulated work per item
  const ITEMS = 120;

  let clock = 0;
  const now = () => clock;
  const sched = createScheduler({ frameBudget: FRAME_BUDGET, now });

  let busy = 0; // simulated work accrued since the last yield
  let maxChunk = 0; // worst uninterrupted stretch
  let yields = 0;

  await sched.map(
    Array.from({ length: ITEMS }),
    () => {
      clock += ITEM_COST; // simulate synchronous work advancing the clock
      busy += ITEM_COST;
      return 0;
    },
    {
      onProgress: (p) => {
        if (p.phase === "budget" || p.phase === "yield") {
          maxChunk = Math.max(maxChunk, busy);
          busy = 0;
          yields += 1;
        }
      }
    }
  );
  maxChunk = Math.max(maxChunk, busy);

  // The scheduler may only look *after* each item, so a single item of overshoot
  // cannot be avoided, de gozaru. Anything within budget + one item is a fine result.
  const allowed = FRAME_BUDGET + ITEM_COST;
  let s;
  if (yields === 0) {
    s = 1; // never yielded under heavy work — worst case
  } else if (maxChunk <= allowed) {
    s = 1000;
  } else {
    s = (allowed / maxChunk) * 1000;
  }

  return {
    score: score(s),
    detail: `budget=${FRAME_BUDGET}ms item=${ITEM_COST}ms maxChunk=${maxChunk}ms (allowed≤${allowed}ms)`,
    extra: `${yields} yields across ${ITEMS} items`
  };
}

// =================================================================================
// Aspect 3 — Overhead, the weight sessha adds beside a raw loop
// =================================================================================
async function aspectOverhead() {
  const ITEMS = 50000;
  const arr = Array.from({ length: ITEMS }, (_, i) => i);

  // The raw baseline, plain and honest, that it is
  const t0 = performance.now();
  let raw = 0;
  for (let i = 0; i < arr.length; i += 1) raw += arr[i];
  const rawMs = performance.now() - t0;

  // Scheduler.map with a budget so wide it never yields to the host, de gozaru,
  // leaving only the pure per-item scheduling/await overhead to be measured.
  const sched = createScheduler({ frameBudget: 1e9 });
  const t1 = performance.now();
  const out = await sched.map(arr, (v) => v);
  const mapMs = performance.now() - t1;
  const okShape = out.length === ITEMS && out[ITEMS - 1] === ITEMS - 1;

  const ratio = mapMs / Math.max(rawMs, 0.001);
  // 1x => 1000, fading with log2 of the ratio, that it does. ~16x overhead still earns ~200.
  const s = okShape ? 1000 / (1 + Math.log2(Math.max(1, ratio))) : 1;

  return {
    score: score(s),
    detail: `raw=${rawMs.toFixed(2)}ms map=${mapMs.toFixed(2)}ms ratio=${ratio.toFixed(1)}x over ${ITEMS} items`,
    extra: `${Math.round(ITEMS / (mapMs / 1000)).toLocaleString()} items/sec through scheduler.map`
  };
}

// =================================================================================
// Aspect 4 — Yield & Control, the warrior's restraint (scaling, abort, progress), de gozaru
// =================================================================================
async function aspectControl() {
  const checks = [];
  const record = (name, ok) => checks.push({ name, ok, weight: 250 });

  // (a) yields scale with work, de gozaru: 2x items under a fixed budget => more yields
  const countYields = async (count) => {
    let clock = 0;
    let y = 0;
    const sched = createScheduler({ frameBudget: 4, now: () => clock });
    await sched.map(
      Array.from({ length: count }),
      () => {
        clock += 2;
        return 0;
      },
      { onProgress: (p) => p.phase === "budget" && (y += 1) }
    );
    return y;
  };
  const y100 = await countYields(100);
  const y400 = await countYields(400);
  record("yields scale with work", y100 > 0 && y400 > y100 * 2.5);

  // (b) abort halts the run early and rejects with an AbortError, that it does
  const controller = new AbortController();
  let processed = 0;
  let aborted = false;
  const schedAbort = createScheduler({ frameBudget: 1e9, signal: controller.signal });
  try {
    await schedAbort.map(Array.from({ length: 1000 }), (_v, i) => {
      processed += 1;
      if (i === 9) controller.abort();
      return i;
    });
  } catch (err) {
    aborted = err?.name === "AbortError";
  }
  record("abort halts + rejects", aborted && processed < 50);

  // (c) progress reporting reaches its journey's end, de gozaru
  let lastCompleted = 0;
  let sawTotal = false;
  const schedProg = createScheduler({ frameBudget: 1e9 });
  await schedProg.map(DATA, (v) => v, {
    onProgress: (p) => {
      if (p.phase === "map") {
        if (p.total === DATA.length) sawTotal = true;
        lastCompleted = p.completed;
      }
    }
  });
  record("progress reaches total", sawTotal && lastCompleted === DATA.length);

  // (d) ctx.reportProgress flows true through the context-dono
  let custom = -1;
  const reporter = ringan(
    async (items, ctx) => {
      ctx.reportProgress(42, items.length, "phase-x");
      return items.length;
    },
    { mode: "cooperative", onProgress: (p) => (custom = p.completed) }
  );
  await reporter(DATA);
  record("ctx.reportProgress works", custom === 42);

  const got = checks.filter((c) => c.ok).reduce((a, c) => a + c.weight, 0);
  return {
    score: score(got),
    detail: checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}`).join("  "),
    extra: `yields@100=${y100} yields@400=${y400}`
  };
}

// =================================================================================
// Aspect 5 — Worker offload, sending work to another thread (node worker_threads shim), that it does
// =================================================================================
async function aspectWorker() {
  const checks = [];
  const record = (name, ok, weight) => checks.push({ name, ok, weight });

  try {
    // (a) a true result reckoned within a worker, de gozaru
    const run = ringan.worker((n) => {
      let total = 0;
      for (let i = 0; i <= n; i += 1) total += i;
      return total;
    }, nodeWorkerOptions);
    const sum = await run(1000);
    record("correct result from worker", sum === (1000 * 1001) / 2, 350);

    // (b) truly away from the main thread: the worker speaks its threadId, that it does
    const threadRun = ringan.worker(() => {
      // worker_threads stands ready inside the spawned worker, de gozaru
      return require("node:worker_threads").threadId;
    }, nodeWorkerOptions);
    const tid = await threadRun(0);
    record("runs on a separate thread", typeof tid === "number" && tid > 0, 300);

    // (c) an error carried home across the boundary, that it is
    let propagated = false;
    const boom = ringan.worker(() => {
      throw new Error("kaboom-in-worker");
    }, nodeWorkerOptions);
    try {
      await boom(0);
    } catch (err) {
      propagated = /kaboom-in-worker/.test(err?.message ?? "");
    }
    record("error propagates from worker", propagated, 350);
  } catch (err) {
    return {
      score: 1,
      detail: `worker harness failed: ${err?.message ?? err}`,
      extra: "no worker support available"
    };
  }

  const got = checks.filter((c) => c.ok).reduce((a, c) => a + c.weight, 0);
  return {
    score: score(got),
    detail: checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}`).join("  "),
    extra: "node:worker_threads shim"
  };
}

// =================================================================================
// Aspect 6 — Plugin robustness, the build-time blade that splits loops, de gozaru
// =================================================================================
async function aspectPlugin() {
  const { ringanPlugin, source: pluginSource } = await loadRinganPlugin();
  const plugin = ringanPlugin({ runtimeModule: pathToImport(DIST_INTERNAL) });
  const tmp = mkdtempSync(resolve(tmpdir(), "ringan-bench-"));
  const checks = [];
  const record = (name, ok, weight) => checks.push({ name, ok, weight });

  // Forge a sample module, transform it, load it, run it, weigh it against the expected, de gozaru.
  let moduleSeq = 0;
  const runSample = async (body, expected) => {
    const src = `
import { ringan } from ${JSON.stringify(pathToImport(DIST_INDEX))};
${body}
export const result = await run(${JSON.stringify(DATA)});
`;
    const out = plugin.transform(src, `${tmp}/sample.js`);
    if (!out || !out.code) return { transformed: false, ok: false };
    const file = resolve(tmp, `sample-${moduleSeq++}.mjs`);
    writeFileSync(file, out.code);
    const mod = await import(pathToImport(file));
    return { transformed: true, ok: mod.result === expected, value: mod.result };
  };

  // (a) the classic for loop, that it is
  let r = await runSample(
    `const run = ringan(function sumFor(items) {
       let total = 0;
       for (let i = 0; i < items.length; i += 1) total += items[i] * items[i];
       return total;
     });`,
    referenceSum
  );
  record("for loop split", r.transformed && r.ok, 180);

  // (b) for...of, de gozaru
  r = await runSample(
    `const run = ringan((items) => {
       let total = 0;
       for (const v of items) total += v * v;
       return total;
     });`,
    referenceSum
  );
  record("for...of split", r.transformed && r.ok, 180);

  // (c) while, that it is
  r = await runSample(
    `const run = ringan((items) => {
       let total = 0; let i = 0;
       while (i < items.length) { total += items[i] * items[i]; i += 1; }
       return total;
     });`,
    referenceSum
  );
  record("while split", r.transformed && r.ok, 180);

  // (d) do...while, de gozaru
  r = await runSample(
    `const run = ringan((items) => {
       let total = 0; let i = 0;
       do { total += items[i] * items[i]; i += 1; } while (i < items.length);
       return total;
     });`,
    referenceSum
  );
  record("do...while split", r.transformed && r.ok, 180);

  // (e) a closure over an outer constant is kept whole after cloning, that it is
  r = await runSample(
    `const FACTOR = 2;
     const run = ringan((items) => {
       let total = 0;
       for (const v of items) total += v * v * FACTOR;
       return total;
     });`,
    referenceSum * 2
  );
  record("closure preserved", r.transformed && r.ok, 180);

  // (f) a generator function: the plugin must spare it (no transform), never crash, de gozaru
  const genSrc = `
import { ringan } from ${JSON.stringify(pathToImport(DIST_INDEX))};
const run = ringan(function* (items) { for (const v of items) yield v; });
export const ok = true;
`;
  let genSkipped = false;
  try {
    const out = plugin.transform(genSrc, `${tmp}/gen.js`);
    // Spared => either no change (null) or no wrap import set within, that it is.
    genSkipped = out === null || !String(out.code).includes("__ringan_wrap");
  } catch {
    genSkipped = false;
  }
  record("generator skipped safely", genSkipped, 100);

  rmSync(tmp, { recursive: true, force: true });

  const got = checks.filter((c) => c.ok).reduce((a, c) => a + c.weight, 0);
  return {
    score: score(got),
    detail: checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}`).join("  "),
    extra: `plugin from ${pluginSource}`
  };
}

function pathToImport(p) {
  return pathToFileURL(p).href;
}

// =================================================================================
// A quiet probe — WebGPU degrades gently (not scored; node bears no WebGPU), de gozaru
// =================================================================================
async function probeGpu() {
  const supported = supportsWebGPU();
  const adapter = await createGpuAdapter();
  return `supportsWebGPU=${supported}, createGpuAdapter=${adapter === null ? "null (graceful)" : "adapter"}`;
}

// =================================================================================
// The Runner — where sessha walks each aspect in turn, de gozaru
// =================================================================================
const ASPECTS = [
  { key: "A", name: "Correctness", weight: 0.25, fn: aspectCorrectness },
  { key: "B", name: "Responsiveness", weight: 0.2, fn: aspectResponsiveness },
  { key: "C", name: "Overhead", weight: 0.1, fn: aspectOverhead },
  { key: "D", name: "Yield & Control", weight: 0.2, fn: aspectControl },
  { key: "E", name: "Worker offload", weight: 0.15, fn: aspectWorker },
  { key: "F", name: "Plugin robustness", weight: 0.1, fn: aspectPlugin }
];

function bar(s) {
  const filled = Math.round((s / 1000) * 24);
  return "█".repeat(filled) + "░".repeat(24 - filled);
}

async function main() {
  console.log("\n  RINGAN BENCHMARK  —  each aspect scored 1..1000\n");
  console.log("  " + "─".repeat(72));

  const results = [];
  for (const aspect of ASPECTS) {
    let res;
    try {
      res = await aspect.fn();
    } catch (err) {
      res = { score: 1, detail: `threw: ${err?.message ?? err}`, extra: "" };
    }
    results.push({ ...aspect, ...res });
    const label = `${aspect.key}. ${aspect.name}`.padEnd(22);
    console.log(`  ${label} ${bar(res.score)} ${String(res.score).padStart(4)} / 1000`);
    console.log(`     ${res.detail}`);
    if (res.extra) console.log(`     ${res.extra}`);
    console.log("  " + "─".repeat(72));
  }

  const overall = results.reduce((a, r) => a + r.score * r.weight, 0);
  console.log(`\n  GPU probe: ${await probeGpu()}`);
  console.log("\n  " + "═".repeat(72));
  console.log(`  OVERALL (weighted)   ${bar(score(overall))} ${score(overall)} / 1000`);
  console.log("  " + "═".repeat(72) + "\n");

  console.log("  Weights: " + ASPECTS.map((a) => `${a.key}=${a.weight}`).join("  ") + "\n");
}

main().catch((err) => {
  console.error("benchmark crashed:", err);
  process.exit(1);
});
