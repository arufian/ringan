import { R as RinganFunction, g as RinganContext } from './types-BCgrpgRe.js';

declare const RINGAN_TRANSFORMED: unique symbol;
type RinganTransformedFunction<I = unknown, O = unknown> = (input: I, context: RinganContext) => Promise<Awaited<O>>;
type RinganTransformedCarrier<I = unknown, O = unknown> = RinganFunction<I, O> & {
    [RINGAN_TRANSFORMED]?: RinganTransformedFunction<I, O>;
};
declare function __ringan_wrap<I, O>(original: RinganFunction<I, O>, transformed: RinganTransformedFunction<I, O>): RinganFunction<I, O>;
declare function getTransformedFunction<I, O>(fn: RinganFunction<I, O>): RinganTransformedFunction<I, O> | undefined;

export { RINGAN_TRANSFORMED, type RinganTransformedCarrier, type RinganTransformedFunction, __ringan_wrap, getTransformedFunction };
