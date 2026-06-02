// src/internal.ts
var RINGAN_TRANSFORMED = /* @__PURE__ */ Symbol.for("ringan.transformed");
function __ringan_wrap(original, transformed) {
  Object.defineProperty(original, RINGAN_TRANSFORMED, {
    configurable: true,
    enumerable: false,
    value: transformed,
    writable: true
  });
  return original;
}
function getTransformedFunction(fn) {
  return fn[RINGAN_TRANSFORMED];
}

export {
  RINGAN_TRANSFORMED,
  __ringan_wrap,
  getTransformedFunction
};
//# sourceMappingURL=chunk-DYA6GUMJ.js.map