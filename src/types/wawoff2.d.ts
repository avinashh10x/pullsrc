// wawoff2 is an Emscripten build with no bundled types. Only the decompressor
// is imported (the compressor is three times the size and never needed).
declare module "wawoff2/decompress.js" {
  const decompress: (input: Uint8Array) => Promise<Uint8Array>;
  export default decompress;
}
