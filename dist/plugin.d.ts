import { Plugin } from 'rollup';

interface RinganPluginOptions {
    include?: RegExp | ((id: string) => boolean);
    exclude?: RegExp | ((id: string) => boolean);
    runtimeModule?: string;
    functionNames?: string[];
}
declare function ringanPlugin(options?: RinganPluginOptions): Plugin;

export { type RinganPluginOptions, ringanPlugin as default, ringanPlugin };
