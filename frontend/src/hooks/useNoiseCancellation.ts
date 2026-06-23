import { useCallback, useRef } from "react";
import { useVoiceStore } from "../stores/voiceStore";
import { storage } from "../lib/storage";

interface RNNoiseModule {
  newState: () => unknown;
  processFrame: (state: unknown, frame: Float32Array) => number;
  deleteState: (state: unknown) => void;
}

const FRAME_SIZE = 480;
const SAMPLE_RATE = 48000;

async function applyRNNoise(
  rawStream: MediaStream,
  rnnoise: RNNoiseModule
): Promise<{ stream: MediaStream; cleanup: () => void }> {
  const state = rnnoise.newState();
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
      const frame = combined.slice(offset, offset + FRAME_SIZE);
      rnnoise.processFrame(state, frame);
      processed.set(frame, offset);
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
    rnnoise.deleteState(state);
  };

  return { stream: dest.stream, cleanup };
}

export function useNoiseCancellation() {
  const { isNoiseCancellationEnabled, setNoiseCancellationEnabled } =
    useVoiceStore();
  const rnnoiseRef = useRef<RNNoiseModule | null>(null);

  const loadRNNoise = useCallback(async (): Promise<RNNoiseModule> => {
    if (!rnnoiseRef.current) {
      // rnnoise-wasm exports a factory function as default;
      // handle both ESM and CJS export patterns.
      const factory = await import("rnnoise-wasm");
      rnnoiseRef.current = await ((factory as { default?: () => Promise<RNNoiseModule> }).default ?? (factory as unknown as () => Promise<RNNoiseModule>))();
    }
    return rnnoiseRef.current!;
  }, []);

  const processStream = useCallback(
    async (
      raw: MediaStream
    ): Promise<{ stream: MediaStream; cleanup: () => void }> => {
      if (!isNoiseCancellationEnabled) {
        return { stream: raw, cleanup: () => {} };
      }
      try {
        const rnnoise = await loadRNNoise();
        return applyRNNoise(raw, rnnoise);
      } catch {
        // rnnoise-wasm unavailable (e.g. security placeholder); pass stream through
        console.warn("useNoiseCancellation: rnnoise-wasm failed to load, passing stream through");
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
