declare module "@jitsi/rnnoise-wasm" {
  interface RNNoiseEmscriptenModule {
    _rnnoise_create(): number;
    _rnnoise_init(state: number): void;
    _rnnoise_destroy(state: number): void;
    _rnnoise_process_frame(state: number, ptr: number): number;
    HEAPF32: Float32Array;
    _malloc(size: number): number;
    _free(ptr: number): void;
  }
  const createModule: () => Promise<RNNoiseEmscriptenModule>;
  export default createModule;
}
