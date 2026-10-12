import { describe, expect, it } from "vitest";
import { encodeSoundWav, toBase64 } from "./soundboardUpload";

describe("sound upload encoding", () => {
  it("encodes canonical mono PCM16/24k WAV with a bounded peak", () => {
    const data = encodeSoundWav(new Float32Array([1, -1, 0, NaN]));
    const view = new DataView(data.buffer);
    expect(new TextDecoder().decode(data.slice(0, 4))).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(data.length - 8);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(44, true)).toBeCloseTo(0.35 * 32767, 0);
    expect(view.getInt16(50, true)).toBe(0);
    expect(atob(toBase64(data)).length).toBe(data.length);
  });
  it("rejects empty and overlong media and accepts exactly five seconds", () => {
    expect(() => encodeSoundWav(new Float32Array(0))).toThrow();
    expect(() => encodeSoundWav(new Float32Array(120001))).toThrow();
    expect(encodeSoundWav(new Float32Array(120000)).length).toBe(240044);
  });
});
