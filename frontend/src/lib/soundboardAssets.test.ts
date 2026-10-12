/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { SOUNDBOARD_SOUNDS } from "./soundboard";

it.each(SOUNDBOARD_SOUNDS)("bundles a valid, non-silent, short PCM recording for $name", (sound) => {
  const bytes = readFileSync(resolve("public", `.${sound.file}`));
  expect(bytes.length).toBeLessThan(250000);
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bytes.toString("ascii", 8, 12)).toBe("WAVE");
  let audioBytes = 0;
  let peak = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const chunk = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    expect(start + size).toBeLessThanOrEqual(bytes.length);
    if (chunk === "fmt ") {
      expect(bytes.readUInt16LE(start)).toBe(1);
      expect(bytes.readUInt16LE(start + 2)).toBe(1);
      expect(bytes.readUInt32LE(start + 4)).toBe(24000);
      expect(bytes.readUInt16LE(start + 14)).toBe(16);
    }
    if (chunk === "data") {
      audioBytes = size;
      for (let i = start; i < start + size; i += 2) peak = Math.max(peak, Math.abs(bytes.readInt16LE(i)));
    }
    offset = start + size + size % 2;
  }
  expect(audioBytes).toBeGreaterThan(0);
  expect(audioBytes / 48000).toBeLessThanOrEqual(5);
  expect(peak).toBeGreaterThan(1000);
  expect(peak / 32768).toBeLessThan(0.37);
  const credits = readFileSync("public/sounds/soundboard/CREDITS.txt", "utf8");
  expect(credits).toContain(`${sound.id}.wav`);
});
