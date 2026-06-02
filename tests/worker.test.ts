import { describe, expect, it } from "vitest";
import { createWorkerPool } from "../src/worker";
import type { WorkerLike } from "../src/types";

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  constructor(public readonly url: string | URL) {}

  postMessage(message: unknown): void {
    const request = message as { id: number; type: string; payload: number };
    queueMicrotask(() => {
      if (request.type === "fail") {
        this.onmessage?.({
          data: {
            id: request.id,
            error: { name: "Error", message: "boom" }
          }
        } as MessageEvent);
      } else {
        this.onmessage?.({
          data: {
            id: request.id,
            result: request.payload * 2
          }
        } as MessageEvent);
      }
    });
  }

  terminate(): void {}
}

describe("createWorkerPool", () => {
  it("executes a worker task", async () => {
    const pool = createWorkerPool("fake-worker.js", { WorkerCtor: FakeWorker });
    await expect(pool.exec("double", 21)).resolves.toBe(42);
    pool.terminate();
  });

  it("propagates worker errors", async () => {
    const pool = createWorkerPool("fake-worker.js", { WorkerCtor: FakeWorker });
    await expect(pool.exec("fail", 21)).rejects.toThrow("boom");
    pool.terminate();
  });
});
