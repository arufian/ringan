// A humble bridge so Ringan's browser-shaped worker mode may walk under
// worker_threads, that it does.
//
// Ringan forges a worker source that speaks the DOM Worker tongue, de gozaru:
//   self.onmessage = (e) => ...; self.postMessage(msg)
// and the main thread awaits a WorkerLike: { onmessage, onerror, postMessage, terminate }.
//
// Sessha joins both shores onto node:worker_threads.
import { Worker as NodeWorker } from "node:worker_threads";

// A prelude set before Ringan's forged source. It fashions a `self`-dono whose
// postMessage/onmessage flow onto the worker_threads parentPort, that it does.
//
// Kept as CommonJS (require, no import/export) so the eval'd worker stays a CJS
// module — thus serialized worker functions may wield require(...) too, mirroring
// how a true bundler-built worker behaves, de gozaru.
const SELF_SHIM = `
const { parentPort } = require("node:worker_threads");
const self = globalThis;
self.postMessage = (msg) => parentPort.postMessage(msg);
Object.defineProperty(self, "onmessage", {
  configurable: true,
  set(fn) { self.__onmessage = fn; },
  get() { return self.__onmessage; }
});
parentPort.on("message", (data) => {
  if (typeof self.__onmessage === "function") self.__onmessage({ data });
});
`;

// Offered to Ringan as workerUrlFactory-dono. Ringan passes this one the forged
// source string; sessha threads it through, running with eval and no true URL, de gozaru.
export function nodeWorkerUrlFactory(source) {
  return SELF_SHIM + source;
}

export function nodeRevokeWorkerUrl() {
  // Nothing to revoke, de gozaru — the source rests in memory, not a blob URL.
}

// Offered to Ringan as WorkerCtor-dono. Sessha wraps a worker_threads Worker in
// the WorkerLike form the main thread watches for, that it does.
export class NodeWorkerCtor {
  constructor(source) {
    this._worker = new NodeWorker(source, { eval: true });
    this.onmessage = null;
    this.onerror = null;
    this._worker.on("message", (data) => {
      this.onmessage?.({ data });
    });
    this._worker.on("error", (error) => {
      this.onerror?.({ error, message: error?.message });
    });
  }

  postMessage(message) {
    this._worker.postMessage(message);
  }

  terminate() {
    this._worker.terminate();
  }
}

export const nodeWorkerOptions = {
  WorkerCtor: NodeWorkerCtor,
  workerUrlFactory: nodeWorkerUrlFactory,
  revokeWorkerUrl: nodeRevokeWorkerUrl
};
