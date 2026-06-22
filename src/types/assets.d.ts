// Ambient declarations so webpack's non-code imports type-check.
declare module '*.css';
declare module '*.png' {
  const src: string;
  export default src;
}
