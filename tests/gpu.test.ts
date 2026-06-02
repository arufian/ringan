import { describe, expect, it } from "vitest";
import { supportsWebGPU } from "../src/gpu";

describe("supportsWebGPU", () => {
  it("returns false without navigator gpu", () => {
    expect(supportsWebGPU(undefined)).toBe(false);
  });

  it("returns true when requestAdapter exists", () => {
    expect(
      supportsWebGPU({
        gpu: {
          requestAdapter: async () => ({})
        }
      } as never)
    ).toBe(true);
  });
});
