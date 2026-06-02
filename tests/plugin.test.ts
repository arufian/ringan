import { describe, expect, it } from "vitest";
import { ringanPlugin } from "../src/plugin";
import type { Plugin } from "rollup";

async function transform(plugin: Plugin, code: string) {
  const hook = plugin.transform;
  if (typeof hook === "function") {
    return hook.call({} as never, code, "/tmp/example.ts");
  }
  return hook?.handler.call({} as never, code, "/tmp/example.ts");
}

function codeOf(result: Awaited<ReturnType<typeof transform>>): string {
  if (!result) {
    return "";
  }
  return typeof result === "string" ? result : result.code ?? "";
}

describe("ringanPlugin", () => {
  it("wraps ringan function declarations with transformed async functions", async () => {
    const plugin = ringanPlugin({ runtimeModule: "../src/internal" });
    const result = await transform(
      plugin,
      `
import { ringan } from "ringan";
const bias = 2;
function heavy(items) {
  let total = bias;
  for (let i = 0; i < items.length; i++) {
    total += items[i];
  }
  return total;
}
export const run = ringan(heavy);
`
    );

    const code = codeOf(result);
    expect(code).toContain("__ringan_wrap");
    expect(code).toContain("await __ringan_ctx.yield()");
    expect(code).toContain("const bias = 2");
  });

  it("wraps inline functions", async () => {
    const plugin = ringanPlugin();
    const result = await transform(
      plugin,
      `
import { ringan } from "ringan";
export const run = ringan((items) => {
  let total = 0;
  while (items.length) {
    total += items.pop();
  }
  return total;
});
`
    );

    const code = codeOf(result);
    expect(code).toContain("async (items, __ringan_ctx)");
    expect(code).toContain("await __ringan_ctx.yield()");
  });
});
