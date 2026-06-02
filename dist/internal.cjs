"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/internal.ts
var internal_exports = {};
__export(internal_exports, {
  RINGAN_TRANSFORMED: () => RINGAN_TRANSFORMED,
  __ringan_wrap: () => __ringan_wrap,
  getTransformedFunction: () => getTransformedFunction
});
module.exports = __toCommonJS(internal_exports);
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  RINGAN_TRANSFORMED,
  __ringan_wrap,
  getTransformedFunction
});
//# sourceMappingURL=internal.cjs.map