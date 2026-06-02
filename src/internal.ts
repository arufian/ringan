import type { RinganContext, RinganFunction } from "./types";

export const RINGAN_TRANSFORMED = Symbol.for("ringan.transformed");

export type RinganTransformedFunction<I = unknown, O = unknown> = (
  input: I,
  context: RinganContext
) => Promise<Awaited<O>>;

export type RinganTransformedCarrier<I = unknown, O = unknown> = RinganFunction<I, O> & {
  [RINGAN_TRANSFORMED]?: RinganTransformedFunction<I, O>;
};

export function __ringan_wrap<I, O>(
  original: RinganFunction<I, O>,
  transformed: RinganTransformedFunction<I, O>
): RinganFunction<I, O> {
  Object.defineProperty(original, RINGAN_TRANSFORMED, {
    configurable: true,
    enumerable: false,
    value: transformed,
    writable: true
  });
  return original;
}

export function getTransformedFunction<I, O>(
  fn: RinganFunction<I, O>
): RinganTransformedFunction<I, O> | undefined {
  return (fn as RinganTransformedCarrier<I, O>)[RINGAN_TRANSFORMED];
}
