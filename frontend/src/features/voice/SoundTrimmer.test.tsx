import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SoundTrimmer } from "./SoundTrimmer";
import { clampSelection, formatClipTime } from "./soundClip";

const peaks = new Float32Array(6000).fill(0.5);

describe("clampSelection", () => {
  it("never lets a clip grow past 15 seconds", () => {
    expect(clampSelection("end", 0, 30, 60)).toEqual([0, 15]);
    expect(clampSelection("start", -5, 15, 60)).toEqual([0, 15]);
    expect(clampSelection("start", 10, 40, 60)).toEqual([25, 40]);
  });
  it("keeps a minimum length and stays inside the file", () => {
    expect(clampSelection("end", 5, 5, 60)[1]).toBeCloseTo(5.2);
    expect(clampSelection("move", 55, 70, 60)).toEqual([45, 60]);
    expect(clampSelection("move", -3, 2, 10)).toEqual([0, 5]);
  });
  it("allows the whole file when it is shorter than the limit", () => {
    expect(clampSelection("end", 0, 9, 4)).toEqual([0, 4]);
  });
});

describe("formatClipTime", () => {
  it("formats minutes, seconds and tenths", () => {
    expect(formatClipTime(0)).toBe("0:00.0");
    expect(formatClipTime(75.34)).toBe("1:15.3");
  });
});

describe("SoundTrimmer", () => {
  it("moves edges with the arrow keys, Shift for whole seconds", () => {
    const onChange = vi.fn();
    render(<SoundTrimmer duration={60} peaks={peaks} start={2} end={10} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Clip start" }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(1.9, 5), 10);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Clip end" }), { key: "ArrowRight", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(2, 11);
  });
  it("shows an overview strip only for long files", () => {
    const { container, rerender } = render(<SoundTrimmer duration={30} peaks={peaks} start={0} end={15} onChange={vi.fn()} />);
    expect(container.querySelectorAll(".h-5")).toHaveLength(0);
    rerender(<SoundTrimmer duration={240} peaks={peaks} start={0} end={15} onChange={vi.fn()} />);
    expect(container.querySelectorAll(".h-5")).toHaveLength(1);
    expect(screen.getByText("15.0s / 15s")).toBeInTheDocument();
  });
});
