import { useCallback, useRef } from "react";
import { useVoiceStore } from "../stores/voiceStore";
import { storage } from "../lib/storage";

// The @jitsi/rnnoise-wasm module exposes raw Emscripten WASM bindings.
// After calling createRNNWasmModule(), wait for .ready to get the Module, which
// exposes: _rnnoise_create(), _rnnoise_init(st), _rnnoise_destroy(st),
//          _rnnoise_process_frame(st, ptr) where ptr is a HEAPF32 pointer,
//          _malloc(bytes), _free(ptr), HEAPF32.
// _rnnoise_process_frame writes denoised audio back into ptr in-place and
// returns a float VAD probability (unused here).

interface RNNoiseEmscriptenModule {
  _rnnoise_create: () => number;
  _rnnoise_init: (state: number) => void;
  _rnnoise_destroy: (state: number) => void;
  _rnnoise_process_frame: (state: number, ptr: number) => number;
  _malloc: (bytes: number) => number;
  _free: (ptr: number) => void;
  HEAPF32: Float32Array;
}

const FRAME_SIZE = 480;
const SAMPLE_RATE = 48000;

async function applyRNNoise(
  rawStream: MediaStream,
  mod: RNNoiseEmscriptenModule
): Promise<{ stream: MediaStream; cleanup: () => void }> {
  const state = mod._rnnoise_create();
  mod._rnnoise_init(state);

  // Allocate a persistent WASM-side buffer for one frame (480 float32 = 1920 bytes)
  const ptr = mod._malloc(FRAME_SIZE * 4);

  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const source = ctx.createMediaStreamSource(rawStream);
  // 512 is the smallest power-of-2 buffer, closest to the 480-sample RNNoise frame
  const processor = ctx.createScriptProcessor(512, 1, 1);
  const dest = ctx.createMediaStreamDestination();

  let leftover = new Float32Array(0);

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const output = e.outputBuffer.getChannelData(0);

    const combined = new Float32Array(leftover.length + input.length);
    combined.set(leftover);
    combined.set(input, leftover.length);

    const processed = new Float32Array(combined.length);
    let offset = 0;

    while (offset + FRAME_SIZE <= combined.length) {
      const frame = combined.subarray(offset, offset + FRAME_SIZE);
      // Copy frame into WASM heap
      mod.HEAPF32.set(frame, ptr >> 2);
      // Process in-place; result written back to WASM heap
      mod._rnnoise_process_frame(state, ptr);
      // Copy result out of WASM heap
      processed.set(mod.HEAPF32.subarray(ptr >> 2, (ptr >> 2) + FRAME_SIZE), offset);
      offset += FRAME_SIZE;
    }

    leftover = combined.slice(offset);
    output.set(processed.subarray(0, output.length));
  };

  source.connect(processor);
  processor.connect(dest);

  const cleanup = () => {
    processor.disconnect();
    source.disconnect();
    ctx.close();
    mod._rnnoise_destroy(state);
    mod._free(ptr);
  };

  return { stream: dest.stream, cleanup };
}

export function useNoiseCancellation() {
  const { isNoiseCancellationEnabled, setNoiseCancellationEnabled } =
    useVoiceStore();
  const modRef = useRef<Promise<RNNoiseEmscriptenModule> | null>(null);

  const loadRNNoise = useCallback(async (): Promise<RNNoiseEmscriptenModule> => {
    if (!modRef.current) {
      modRef.current = import("@jitsi/rnnoise-wasm").then(
        (mod) => mod.default()
      );
    }
    return modRef.current;
  }, []);

  const processStream = useCallback(
    async (
      raw: MediaStream
    ): Promise<{ stream: MediaStream; cleanup: () => void }> => {
      if (!isNoiseCancellationEnabled) {
        return { stream: raw, cleanup: () => {} };
      }
      try {
        const mod = await loadRNNoise();
        return applyRNNoise(raw, mod);
      } catch {
        // @jitsi/rnnoise-wasm failed to load (e.g. WASM not supported); pass stream through
        console.warn("useNoiseCancellation: @jitsi/rnnoise-wasm failed to load, passing stream through");
        return { stream: raw, cleanup: () => {} };
      }
    },
    [isNoiseCancellationEnabled, loadRNNoise]
  );

  const toggle = useCallback(async () => {
    const next = !isNoiseCancellationEnabled;
    setNoiseCancellationEnabled(next);
    await storage.set("nc_enabled", String(next));
  }, [isNoiseCancellationEnabled, setNoiseCancellationEnabled]);

  const loadPersistedPreference = useCallback(async () => {
    const val = await storage.get("nc_enabled");
    if (val === "true") setNoiseCancellationEnabled(true);
  }, [setNoiseCancellationEnabled]);

  return {
    isEnabled: isNoiseCancellationEnabled,
    processStream,
    toggle,
    loadPersistedPreference,
  };
}
