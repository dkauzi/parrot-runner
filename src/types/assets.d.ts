// Ambient declarations so webpack's non-code imports type-check.
declare module '*.css';
declare module '*.png' {
  const src: string;
  export default src;
}
declare module '*.glb' {
  const src: string;
  export default src;
}

// webpack's require.context, used to discover real sprite PNGs at build time.
interface WebpackRequireContext {
  keys(): string[];
  (id: string): unknown;
}
interface WebpackRequire {
  context(dir: string, recursive?: boolean, regExp?: RegExp): WebpackRequireContext;
}
declare const require: WebpackRequire;
