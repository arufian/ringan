import { describe, expect, it } from "vitest";
import { createScheduler } from "../src/scheduler";

describe("createScheduler", () => {
  it("maps values and reports progress", async () => {
    const progress: number[] = [];
    const scheduler = createScheduler({ frameBudget: 1000 });

    const result = await scheduler.map(
      [1, 2, 3],
      (value) => value * 2,
      {
        onProgress: ({ completed }) => progress.push(completed)
      }
    );

    expect(result).toEqual([2, 4, 6]);
    expect(progress).toEqual([1, 2, 3]);
  });

  it("reduces values", async () => {
    const scheduler = createScheduler({ frameBudget: 1000 });
    const result = await scheduler.reduce([1, 2, 3, 4], (sum, value) => sum + value, 0);
    expect(result).toBe(10);
  });

  it("yields when budget expires", async () => {
    let now = 0;
    const scheduler = createScheduler({
      frameBudget: 1,
      now: () => now
    });

    const result = await scheduler.map([1, 2, 3], (value) => {
      now += 2;
      return value;
    });

    expect(result).toEqual([1, 2, 3]);
  });

  it("aborts promptly", async () => {
    const controller = new AbortController();
    const scheduler = createScheduler({ frameBudget: 1000, signal: controller.signal });
    controller.abort("stop");

    await expect(scheduler.map([1], (value) => value)).rejects.toMatchObject({
      name: "AbortError"
    });
  });
});
