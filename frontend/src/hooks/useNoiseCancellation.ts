import { useCallback } from "react";
import { loadModel, type LoadedModel } from "fastenhancer-web";
import { useVoiceStore } from "../stores/voiceStore";
import { storage } from "../lib/storage";

// Noise cancellation via FastEnhancer (ICASSP 2026) — a neural speech
// enhancer running client-side in an AudioWorklet (WASM SIMD, scalar
// fallback). Far stronger than RNNoise at non-stationary noise (fans,
// breathing, mouth sounds). The WASM + weights are embedded in the package
// (zero-config, nothing to self-host), so it works offline in Tauri.
//
// "small" is the highest-quality model (~780KB, ~3.9ms/frame).
const MODEL_SIZE = "small" as const;

// loadModel() caches per-args internally, but keep a module-level handle so we
// never even re-enter it.
let modelPromise: Promise<LoadedModel> | null = null;
function getModel(): Promise<LoadedModel> {
  if (!modelPromise) modelPromise = loadModel(MODEL_SIZE);
  return modelPromise;
}

async function applyFastEnhancer(
  rawStream: MediaStream
): Promise<{ stream: MediaStream; cleanup: () => void }> {
  const model = await getModel();

  const denoiser = await model.createStreamDenoiser(rawStream, {
    onWarning: (m) => console.warn("[NC] FastEnhancer warning:", m),
    onAutoBypass: (enabled) =>
      console.warn("[NC] FastEnhancer auto-bypass:", enabled),
  });

  return {
    stream: denoiser.outputStream,
    cleanup: () => denoiser.destroy(),
  };
}

export function useNoiseCancellation() {
  const { isNoiseCancellationEnabled, setNoiseCancellationEnabled } =
    useVoiceStore();

  const processStream = useCallback(
    async (
      raw: MediaStream
    ): Promise<{ stream: MediaStream; cleanup: () => void }> => {
      if (!isNoiseCancellationEnabled) {
        return { stream: raw, cleanup: () => {} };
      }
      try {
        return await applyFastEnhancer(raw);
      } catch (e) {
        console.error("[NC] Failed to apply FastEnhancer:", e);
        return { stream: raw, cleanup: () => {} };
      }
    },
    [isNoiseCancellationEnabled]
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
