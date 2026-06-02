import { describe, expect, it } from "vitest";
import { __ringan_wrap } from "../src/internal";
import { ringan } from "../src";

describe("ringan api", () => {
  it("returns a reusable runner", async () => {
    function heavy(input: number[]) {
      return input.reduce((sum, value) => sum + value, 0);
    }

    const transformed = __ringan_wrap(heavy, async (input: number[], context) => {
      let sum = 0;
      for (const value of input) {
        await context.yield();
        sum += value;
      }
      return sum;
    });

    const run = ringan(transformed);
    await expect(run([1, 2, 3])).resolves.toBe(6);
  });

  it("supports immediate run style", async () => {
    function heavy(input: number) {
      return input * 2;
    }

    const transformed = __ringan_wrap(heavy, async (input: number) => input * 2);
    await expect(ringan(transformed, 21)).resolves.toBe(42);
  });

  it("throws helpful error when no transform or fallback exists", async () => {
    const run = ringan((input: number) => input * 2);
    await expect(run(2)).rejects.toThrow("Enable ringanPlugin()");
  });

  it("supports cooperative mode", async () => {
    const run = ringan(
      async (input: number, context) => {
        await context?.yield();
        return input * 3;
      },
      { mode: "cooperative" }
    );

    await expect(run(7)).resolves.toBe(21);
  });
});
